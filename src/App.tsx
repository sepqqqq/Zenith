import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { createRegionSender, type RegionRect } from "./windowRegion";
import { useSettingsSync } from "./hooks/useSettingsSync";
import "./App.css";

type ExpandedMode = "music" | "lyrics" | "shelf" | "resting" | "headphones" | "charging" | "timer";
type IslandState = "closed" | ExpandedMode;

interface MediaInfo {
  title: string;
  artist: string;
  is_playing: boolean;
  has_media: boolean;
  artwork?: string[];
  position_ms: number;
  duration_ms: number;
  seek_enabled: boolean;
}

interface ShelfItem {
  id: string;
  name: string;
  size: string;
  path?: string;
}

export function Visualizer(_props?: any) {
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function App() {
  const [activeExpandedMode, setActiveExpandedMode] = useState<ExpandedMode>("music");
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [notchMode, setNotchMode] = useState<string>(() => localStorage.getItem("bloom-notch-mode") || "smart");
  const [showMenu, setShowMenu] = useState<boolean>(false);
  const notchRef = useRef<HTMLDivElement>(null);

  // Sync settings for notch mode (smart, fixed, peek)
  useSettingsSync({
    "bloom-notch-mode": (val) => {
      const mode = String(val);
      setNotchMode(mode);
      localStorage.setItem("bloom-notch-mode", mode);
    }
  });

  // Effective visual state
  // If notchMode is "fixed", it stays expanded in activeExpandedMode.
  // If "smart" or "peek", it expands on hover and collapses to "closed" on mouse leave.
  const state: IslandState = notchMode === "fixed" ? activeExpandedMode : isHovered ? activeExpandedMode : "closed";

  // Status values
  const [timeWib, setTimeWib] = useState<string>("14:00");
  const [weatherTemp, setWeatherTemp] = useState<string>("29°C");
  const [batteryLevel, setBatteryLevel] = useState<number>(85);

  // Music state (connected to Windows GSMTC)
  const [trackTitle, setTrackTitle] = useState<string>("Paper Sky");
  const [trackArtist, setTrackArtist] = useState<string>("Lumen Coast — Summer Flows");
  const [albumArt, setAlbumArt] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentSec, setCurrentSec] = useState<number>(74); // 01:14
  const [totalSec, setTotalSec] = useState<number>(196); // 03:16
  const [hasRealMedia, setHasRealMedia] = useState<boolean>(false);

  // Focus Timer
  const [timerSec, setTimerSec] = useState<number>(25 * 60);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);

  // Shelf state with persistent storage
  const [shelfItems, setShelfItems] = useState<ShelfItem[]>(() => {
    try {
      const saved = localStorage.getItem("bloom-shelf-items");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      { id: "1", name: "beach.jpg", size: "2.4 MB" },
      { id: "2", name: "project.zip", size: "14.8 MB" }
    ];
  });

  useEffect(() => {
    try {
      localStorage.setItem("bloom-shelf-items", JSON.stringify(shelfItems));
    } catch {}
  }, [shelfItems]);

  // Window Region Sender for click-through
  const regionSender = useRef<((rects: RegionRect[]) => void) | null>(null);

  const updateWindowRegion = useCallback(() => {
    if (!notchRef.current) return;
    const rect = notchRef.current.getBoundingClientRect();

    const padX = 40;
    const padY = 24;
    const notchBox: RegionRect = {
      x: Math.max(0, Math.floor(rect.left - padX)),
      y: 0,
      width: Math.ceil(rect.width + padX * 2),
      height: Math.ceil(rect.height + padY)
    };

    const wanted: RegionRect[] = [notchBox];

    if (showMenu) {
      wanted.push({
        x: Math.floor(window.innerWidth / 2 - 250),
        y: 44,
        width: 500,
        height: 54
      });
    }

    invoke("update_notch_rect", {
      rect: {
        x: Math.floor(rect.left),
        y: 0,
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height)
      }
    }).catch(() => {});

    if (regionSender.current) {
      regionSender.current(wanted);
    } else {
      invoke("set_window_region", { rects: wanted }).catch(() => {});
    }
  }, [showMenu]);

  // Initialize Tauri window & mouse hook event listener
  useEffect(() => {
    try {
      const win = getCurrentWebviewWindow();
      win.show().catch(() => {});
    } catch {}

    regionSender.current = createRegionSender((rects) => {
      invoke("set_window_region", { rects }).catch(() => {});
    });

    const timer = setTimeout(updateWindowRegion, 100);
    window.addEventListener("resize", updateWindowRegion);

    // Listen to Rust low-level mouse hook edge hover
    let unlistenHover: any;
    listen<boolean>("notch-edge-hover", (event) => {
      if (notchMode !== "fixed") {
        setIsHovered(Boolean(event.payload));
      }
    }).then((fn) => { unlistenHover = fn; });

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateWindowRegion);
      if (unlistenHover) unlistenHover();
    };
  }, [updateWindowRegion, notchMode]);

  // Update region whenever state changes
  useEffect(() => {
    const t = setTimeout(updateWindowRegion, 50);
    const t2 = setTimeout(updateWindowRegion, 520);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [state, showMenu, updateWindowRegion]);

  // Real Windows Media Listener (Spotify, Chrome, YouTube)
  useEffect(() => {
    let active = true;
    const setupMedia = async () => {
      try {
        const unlisten = await listen<MediaInfo>("media-update", (event) => {
          if (!active) return;
          const info = event.payload;
          if (info && info.has_media && (info.title || info.artist)) {
            setHasRealMedia(true);
            if (info.title) setTrackTitle(info.title);
            if (info.artist) setTrackArtist(info.artist);
            setIsPlaying(info.is_playing);
            if (info.position_ms) setCurrentSec(Math.floor(info.position_ms / 1000));
            if (info.duration_ms && info.duration_ms > 0) {
              setTotalSec(Math.floor(info.duration_ms / 1000));
            }
            if (info.artwork && info.artwork.length > 0) {
              setAlbumArt(info.artwork[0]);
            }
            if (info.is_playing) {
              setActiveExpandedMode("music");
            }
          }
        });
        return unlisten;
      } catch {}
    };

    let cleanup: any;
    setupMedia().then((fn) => { cleanup = fn; });
    return () => {
      active = false;
      if (cleanup) cleanup();
    };
  }, []);

  // Timer countdown
  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => {
      setTimerSec((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timerRunning]);

  // WIB Realtime Clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      };
      const formatted = new Intl.DateTimeFormat("id-ID", options).format(now).replace(".", ":");
      setTimeWib(formatted);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  // Weather fetch (Open-Meteo)
  useEffect(() => {
    const getWeather = async () => {
      try {
        const res = await fetch(
          "https://api.open-meteo.com/v1/forecast?latitude=-6.2088&longitude=106.8456&current=temperature_2m,weather_code"
        );
        if (!res.ok) return;
        const data = await res.json();
        setWeatherTemp(`${Math.round(data.current.temperature_2m)}°C`);
      } catch {
        setWeatherTemp("29°C");
      }
    };
    getWeather();
    const interval = setInterval(getWeather, 300000);
    return () => clearInterval(interval);
  }, []);

  // Battery Status
  useEffect(() => {
    if ("getBattery" in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        const update = () => setBatteryLevel(Math.round(battery.level * 100));
        update();
        battery.addEventListener("levelchange", update);
      });
    }
  }, []);

  // Music progress timer simulation when no live Windows player active
  useEffect(() => {
    if (!isPlaying || hasRealMedia) return;
    const interval = setInterval(() => {
      setCurrentSec((prev) => (prev >= totalSec ? 0 : prev + 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying, hasRealMedia, totalSec]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const rem = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  };

  // Synced lyrics calculation
  const lyricLines = [
    { text: "Morning folds the city light", time: 0 },
    { text: "into paper birds tonight", time: 18 },
    { text: "If I could be by your side", time: 35 },
    { text: "I'd give you all my seasons", time: 52 },
    { text: "every summer, every rain", time: 74 },
    { text: "calling out your name", time: 95 }
  ];

  let activeLyricIdx = 0;
  lyricLines.forEach((item, idx) => {
    if (currentSec >= item.time) activeLyricIdx = idx;
  });

  // Media commands
  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("media_play_pause").catch(() => {});
    setIsPlaying((prev) => !prev);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("media_next").catch(() => {});
    setCurrentSec(0);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("media_previous").catch(() => {});
    setCurrentSec(0);
  };

  // Handle Drag & Drop for Shelf
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsHovered(true);
    setActiveExpandedMode("shelf");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const added: ShelfItem[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        added.push({
          id: `${Date.now()}_${i}`,
          name: file.name,
          size: formatBytes(file.size),
          path: (file as any).path || ""
        });
      }
      setShelfItems((prev) => [...added, ...prev]);
    }
  };

  const handleBrowseFiles = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const selected = await openFileDialog({
        multiple: true,
        title: "Pilih file untuk Shelf"
      });
      if (selected && Array.isArray(selected)) {
        const added: ShelfItem[] = selected.map((filePath, i) => {
          const parts = filePath.split(/[/\\]/);
          const name = parts[parts.length - 1] || "file";
          return {
            id: `${Date.now()}_${i}`,
            name,
            size: "File",
            path: filePath
          };
        });
        setShelfItems((prev) => [...added, ...prev]);
      }
    } catch {}
  };

  const handleOpenFile = async (item: ShelfItem) => {
    if (item.path) {
      try {
        await openPath(item.path);
      } catch {}
    }
  };

  // Notch Mouse Enter & Leave for Auto Expand / Shrink
  const handleMouseEnter = () => {
    setIsHovered(true);
    invoke("set_notch_hovered", { hovered: true }).catch(() => {});
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    invoke("set_notch_hovered", { hovered: false }).catch(() => {});
  };

  return (
    <div className="island-screen-wrapper">
      <div
        ref={notchRef}
        className="notch"
        data-state={state}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowMenu((prev) => !prev);
        }}
      >
        <div className="notch-inner">
          {/* 1. RESTING */}
          <div className="ly ly-resting">
            <div className="resting-ambient"></div>
            <div className="eyes-wrap">
              <div className="eye"></div>
              <div className="eye"></div>
            </div>
          </div>

          {/* 2. CLOSED (TAMPILAN UTAMA: CUACA, WAKTU WIB, BATTERY) */}
          <div className="ly ly-closed">
            <div className="closed-weather">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
              <span>{weatherTemp}</span>
            </div>
            <div className="closed-time">
              <span>{timeWib}</span>
              <span className="wib-badge">WIB</span>
            </div>
            <div className="closed-battery">
              <span>{batteryLevel}%</span>
              <div className="battery-icon-wrap">
                <div className="battery-fill" style={{ width: `${batteryLevel}%` }}></div>
              </div>
            </div>
          </div>

          {/* 3. MUSIC */}
          <div className="ly ly-music">
            <div className="music-top">
              <div className="music-cover">
                {albumArt ? (
                  <img src={albumArt} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                )}
              </div>
              <div className="music-info">
                <div className="music-title">{trackTitle}</div>
                <div className="music-artist">{trackArtist}</div>
              </div>
              <div className="eq-wave">
                <div className="eq-bar" style={{ animationPlayState: isPlaying ? "running" : "paused" }}></div>
                <div className="eq-bar" style={{ animationPlayState: isPlaying ? "running" : "paused" }}></div>
                <div className="eq-bar" style={{ animationPlayState: isPlaying ? "running" : "paused" }}></div>
                <div className="eq-bar" style={{ animationPlayState: isPlaying ? "running" : "paused" }}></div>
                <div className="eq-bar" style={{ animationPlayState: isPlaying ? "running" : "paused" }}></div>
              </div>
            </div>

            <div className="music-controls-row">
              <div
                className="music-progress-bar"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  setCurrentSec(Math.floor(pos * totalSec));
                }}
              >
                <div
                  className="music-progress-fill"
                  style={{ width: `${totalSec > 0 ? (currentSec / totalSec) * 100 : 0}%` }}
                ></div>
              </div>
              <div className="music-times">
                <span>{formatTime(currentSec)}</span>
                <span>-{formatTime(Math.max(0, totalSec - currentSec))}</span>
              </div>
              <div className="music-buttons">
                <button
                  className="btn-lyrics-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveExpandedMode("lyrics");
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  LIRIK
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <button className="btn-icon" onClick={handlePrev}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="19 20 9 12 19 4 19 20"></polygon>
                      <line x1="5" y1="19" x2="5" y2="5"></line>
                    </svg>
                  </button>
                  <button className="btn-play-pause btn-icon" onClick={handlePlayPause}>
                    {isPlaying ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                    )}
                  </button>
                  <button className="btn-icon" onClick={handleNext}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 4 15 12 5 20 5 4"></polygon>
                      <line x1="19" y1="5" x2="19" y2="19"></line>
                    </svg>
                  </button>
                </div>
                <div style={{ width: "36px" }}></div>
              </div>
            </div>
          </div>

          {/* 4. LYRICS */}
          <div className="ly ly-lyrics">
            <div className="lyrics-left">
              <div className="lyrics-track">{trackTitle}</div>
              <div className="lyrics-artist">{trackArtist}</div>
              <div className="music-progress-bar" style={{ width: "100%", marginTop: "6px" }}>
                <div
                  className="music-progress-fill"
                  style={{ width: `${totalSec > 0 ? (currentSec / totalSec) * 100 : 0}%` }}
                ></div>
              </div>
              <div className="lyrics-controls-mini">
                <button className="btn-icon" style={{ padding: "4px" }} onClick={handlePlayPause}>
                  {isPlaying ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16"></rect>
                      <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  )}
                </button>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--muted)" }}>
                  {formatTime(currentSec)}
                </span>
              </div>
            </div>
            <div className="lyrics-divider"></div>
            <div className="lyrics-right">
              <div
                className="lyrics-scroller"
                style={{ transform: `translateY(-${activeLyricIdx * 25}px)` }}
              >
                {lyricLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`lyric-line ${idx === activeLyricIdx ? "active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentSec(line.time);
                    }}
                  >
                    {line.text}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 5. SHELF (DRAG & DROP FILES) */}
          <div className="ly ly-shelf">
            <div className="shelf-header">
              <span>FILE SHELF</span>
              <button
                className="shelf-clear"
                onClick={(e) => {
                  e.stopPropagation();
                  setShelfItems([]);
                }}
              >
                CLEAR ALL
              </button>
            </div>
            <div className="shelf-content-row">
              <div className="shelf-cards">
                {shelfItems.map((item) => (
                  <div
                    key={item.id}
                    className="shelf-card"
                    onClick={() => handleOpenFile(item)}
                    title={item.path ? `Klik untuk buka: ${item.path}` : "File"}
                  >
                    <div className="shelf-card-icon">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                      </svg>
                    </div>
                    <div className="shelf-card-info">
                      <div className="shelf-card-name">{item.name}</div>
                      <div className="shelf-card-size">{item.size}</div>
                    </div>
                    <button
                      className="shelf-card-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShelfItems((prev) => prev.filter((i) => i.id !== item.id));
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div
                className="shelf-dropzone"
                onClick={handleBrowseFiles}
                title="Tarik file ke sini atau klik untuk browse"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--accent-cyan)" }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span style={{ fontSize: "11px", fontWeight: 600 }}>Tarik File Ke Sini</span>
                <span style={{ fontSize: "9px", color: "var(--muted)" }}>atau klik untuk pilih</span>
              </div>
            </div>
          </div>

          {/* 6. HEADPHONES */}
          <div className="ly ly-headphones">
            <div className="hp-left">
              <div className="hp-ring-wrap">
                <svg className="ring-svg" viewBox="0 0 32 32">
                  <circle className="ring-bg" cx="16" cy="16" r="14" fill="none" strokeWidth="2.5"></circle>
                  <circle className="ring-fill" cx="16" cy="16" r="14" fill="none" strokeWidth="2.5"></circle>
                </svg>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m7 7 10 10-5 4V3l5 4L7 17"></path>
                </svg>
              </div>
              <div>
                <div className="hp-meta-title">AirBuds Pro</div>
                <div className="hp-meta-sub">
                  <span className="status-dot-active"></span>
                  <span>Connected · 75%</span>
                </div>
              </div>
            </div>
            <div className="hp-right-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" strokeWidth="2" strokeLinecap="round">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
              </svg>
            </div>
          </div>

          {/* 7. CHARGING */}
          <div className="ly ly-charging">
            <div className="charge-left">
              <div className="charge-ring-wrap">
                <svg className="ring-svg" viewBox="0 0 32 32">
                  <circle className="ring-bg" cx="16" cy="16" r="14" fill="none" strokeWidth="2.5" stroke="rgba(0,255,136,0.2)"></circle>
                  <circle className="ring-fill" cx="16" cy="16" r="14" fill="none" strokeWidth="2.5"></circle>
                </svg>
                <svg className="charge-bolt-icon" viewBox="0 0 24 24">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
              </div>
              <div>
                <div className="charge-meta-title">Charging</div>
                <div className="charge-meta-sub">Fast Charge · 120W connected</div>
              </div>
            </div>
            <div className="charge-percent">85%</div>
          </div>

          {/* 8. CALENDAR & TIMER */}
          <div className="ly ly-timer">
            <div className="timer-left">
              <div className="timer-title">Focus Timer</div>
              <div className="timer-display">{formatTime(timerSec)}</div>
            </div>
            <div className="timer-actions">
              <button
                className="timer-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setTimerRunning((prev) => !prev);
                }}
              >
                {timerRunning ? "PAUSE" : "START"}
              </button>
              <button
                className="timer-btn sec"
                onClick={(e) => {
                  e.stopPropagation();
                  setTimerRunning(false);
                  setTimerSec(25 * 60);
                }}
              >
                RESET
              </button>
            </div>
          </div>

          {/* QUICK BOTTOM MODE SWITCHER WHEN EXPANDED */}
          {state !== "closed" && (
            <div className="expanded-mode-bar" onClick={(e) => e.stopPropagation()}>
              {(["music", "lyrics", "shelf", "resting", "headphones", "charging"] as ExpandedMode[]).map((m) => (
                <button
                  key={m}
                  className={`quick-mode-btn ${activeExpandedMode === m ? "active" : ""}`}
                  onClick={() => setActiveExpandedMode(m)}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating State Selector Menu (Shown on right-click) */}
      {showMenu && (
        <div className="desktop-switcher-menu" onClick={(e) => e.stopPropagation()}>
          {(["music", "lyrics", "shelf", "resting", "headphones", "charging", "timer"] as ExpandedMode[]).map((m) => (
            <button
              key={m}
              className={`menu-btn ${activeExpandedMode === m ? "active" : ""}`}
              onClick={() => {
                setActiveExpandedMode(m);
                setShowMenu(false);
              }}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
