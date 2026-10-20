import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { createRegionSender, type RegionRect } from "./windowRegion";
import "./App.css";

type IslandState = "resting" | "closed" | "music" | "lyrics" | "shelf" | "headphones" | "charging";

interface ShelfItem {
  id: string;
  name: string;
  size: string;
}

export function Visualizer(_props?: any) {
  return null;
}

export default function App() {
  const [state, setState] = useState<IslandState>("closed");
  const [showMenu, setShowMenu] = useState<boolean>(false);
  const notchRef = useRef<HTMLDivElement>(null);

  // Status values
  const [timeWib, setTimeWib] = useState<string>("14:00");
  const [weatherTemp, setWeatherTemp] = useState<string>("29°C");
  const [batteryLevel, setBatteryLevel] = useState<number>(85);

  // Music state
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentSec, setCurrentSec] = useState<number>(74); // 01:14
  const totalSec = 196; // 03:16

  // Shelf state
  const [shelfItems, setShelfItems] = useState<ShelfItem[]>([
    { id: "1", name: "beach.jpg", size: "2.4 MB" },
    { id: "2", name: "project.zip", size: "14.8 MB" }
  ]);

  // Window Region Sender for click-through
  const regionSender = useRef<((rects: RegionRect[]) => void) | null>(null);

  const updateWindowRegion = useCallback(() => {
    if (!notchRef.current) return;
    const rect = notchRef.current.getBoundingClientRect();
    const wanted: RegionRect[] = [
      {
        x: Math.floor(rect.left),
        y: 0,
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height) + 10
      }
    ];

    if (showMenu) {
      wanted.push({
        x: Math.floor(window.innerWidth / 2 - 250),
        y: 44,
        width: 500,
        height: 50
      });
    }

    if (regionSender.current) {
      regionSender.current(wanted);
    } else {
      invoke("set_window_region", { rects: wanted }).catch(() => {});
    }
  }, [showMenu]);

  // Initialize Tauri window & region sender
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
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateWindowRegion);
    };
  }, [updateWindowRegion]);

  // Update region whenever state changes
  useEffect(() => {
    const t = setTimeout(updateWindowRegion, 60);
    const t2 = setTimeout(updateWindowRegion, 600); // after spring finishes
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [state, showMenu, updateWindowRegion]);

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

  // Music progress timer
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentSec((prev) => (prev >= totalSec ? 0 : prev + 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying]);

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

  // Notch click handler
  const handleNotchClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest(".music-progress-bar") || target.closest(".shelf-dropzone")) {
      return;
    }
    if (state === "closed" || state === "resting") {
      setState("music");
    } else if (state === "music") {
      setState("lyrics");
    } else if (state === "lyrics") {
      setState("closed");
    }
  };

  return (
    <div className="island-screen-wrapper">
      <div
        ref={notchRef}
        className="notch"
        data-state={state}
        onClick={handleNotchClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowMenu((prev) => !prev);
        }}
      >
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
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </div>
            <div className="music-info">
              <div className="music-title">Paper Sky</div>
              <div className="music-artist">Lumen Coast — Summer Flows</div>
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
                style={{ width: `${(currentSec / totalSec) * 100}%` }}
              ></div>
            </div>
            <div className="music-times">
              <span>{formatTime(currentSec)}</span>
              <span>-{formatTime(totalSec - currentSec)}</span>
            </div>
            <div className="music-buttons">
              <button
                className="btn-lyrics-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  setState("lyrics");
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                LIRIK
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <button className="btn-icon" onClick={(e) => { e.stopPropagation(); setCurrentSec(0); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="19 20 9 12 19 4 19 20"></polygon>
                    <line x1="5" y1="19" x2="5" y2="5"></line>
                  </svg>
                </button>
                <button
                  className="btn-play-pause btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsPlaying((prev) => !prev);
                  }}
                >
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
                <button className="btn-icon" onClick={(e) => { e.stopPropagation(); setCurrentSec(0); }}>
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
            <div className="lyrics-track">Paper Sky</div>
            <div className="lyrics-artist">Lumen Coast</div>
            <div className="music-progress-bar" style={{ width: "100%", marginTop: "6px" }}>
              <div
                className="music-progress-fill"
                style={{ width: `${(currentSec / totalSec) * 100}%` }}
              ></div>
            </div>
            <div className="lyrics-controls-mini">
              <button
                className="btn-icon"
                style={{ padding: "4px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPlaying((prev) => !prev);
                }}
              >
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

        {/* 5. SHELF */}
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
                <div key={item.id} className="shelf-card">
                  <div className="shelf-card-icon">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
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
              onClick={(e) => {
                e.stopPropagation();
                const name = `file_${Date.now().toString().slice(-4)}.doc`;
                setShelfItems((prev) => [{ id: String(Date.now()), name, size: "1.2 MB" }, ...prev]);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--muted)" }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span style={{ fontSize: "11px", fontWeight: 600 }}>Drop files</span>
              <span style={{ fontSize: "9px", color: "var(--muted)" }}>click to add test file</span>
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
      </div>

      {/* Floating State Selector Menu (Shown on right-click or toggle) */}
      {showMenu && (
        <div className="desktop-switcher-menu" onClick={(e) => e.stopPropagation()}>
          {(["resting", "closed", "music", "lyrics", "shelf", "headphones", "charging"] as IslandState[]).map((m) => (
            <button
              key={m}
              className={`menu-btn ${state === m ? "active" : ""}`}
              onClick={() => {
                setState(m);
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
