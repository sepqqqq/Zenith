import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { MessageSquareText, X, RefreshCw, Music } from "lucide-react";
import { Visualizer } from "./App";
import {
	PlayIcon,
	PauseIcon,
	SkipBackIcon,
	SkipForwardIcon,
	MusicNoteIcon,
	SpeakerIcon,
	HeadphonesIcon,
	VolumeLowIcon,
	VolumeHighIcon
} from "./icons";

interface MediaInfo {
	title: string;
	artist: string;
	is_playing: boolean;
	has_media: boolean;
	artwork?: string[];
	position_ms?: number;
	duration_ms?: number;
	seek_enabled?: boolean;
	position_updated_at?: number;
}

interface CompactMediaPlayerProps {
	mediaInfo: MediaInfo;
	albumArtUrl: string | null;
	albumArtKey: number;
	isPlaying: boolean;
	volume: number;
	volumeExpanded: boolean;
	onVolumeExpandedChange: (expanded: boolean) => void;
	onTogglePlayPause: () => void;
	onVolumeChange: (vol: number) => void;
	prevFront: ReturnType<typeof useAnimation>;
	prevBack: ReturnType<typeof useAnimation>;
	nextFront: ReturnType<typeof useAnimation>;
	nextBack: ReturnType<typeof useAnimation>;
	onAnimatePrev: () => void;
	onAnimateNext: () => void;
	onLayoutChange: (layout: "classic" | "compact") => void;
}

interface LyricLine {
	timeMs: number;
	text: string;
}

interface LyricsData {
	lines: LyricLine[];
	isSynced: boolean;
}

const MARQUEE_SPEED = 30;
const MARQUEE_MIN_DURATION = 5;

function TitleMarquee({ title }: { title: string }) {
	const textRef = useRef<HTMLSpanElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isOverflowing, setIsOverflowing] = useState(false);
	const [scrollDistance, setScrollDistance] = useState(0);
	const [scrollDuration, setScrollDuration] = useState(8);

	useEffect(() => {
		const check = () => {
			if (textRef.current && containerRef.current) {
				const textWidth = textRef.current.scrollWidth;
				const containerWidth = containerRef.current.clientWidth;
				const overflow = textWidth > containerWidth;
				setIsOverflowing(overflow);
				if (overflow) {
					const distance = textWidth - containerWidth;
					setScrollDistance(distance);
					setScrollDuration(Math.max(distance / MARQUEE_SPEED, MARQUEE_MIN_DURATION));
				}
			}
		};
		check();
		const observer = new ResizeObserver(check);
		if (containerRef.current) observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, [title]);

	return (
		<div ref={containerRef} className="cmp-marquee-wrap">
			<span
				ref={textRef}
				className={`cmp-title ${isOverflowing ? "cmp-marquee" : ""}`}
				style={
					{
						"--scroll-distance": isOverflowing ? `-${scrollDistance}px` : undefined,
						"--scroll-duration": `${scrollDuration}s`
					} as React.CSSProperties
				}
			>
				{title}
			</span>
		</div>
	);
}

function formatTime(ms: number): string {
	if (ms <= 0) return "00:00";
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatRemaining(elapsed: number, duration: number): string {
	const remaining = Math.max(0, duration - elapsed);
	const totalSeconds = Math.floor(remaining / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `-${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function parseLrc(lrcText: string): LyricLine[] {
	const lines = lrcText.split("\n");
	const result: LyricLine[] = [];
	const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) continue;
		let match;
		timeReg.lastIndex = 0;
		const timestamps: number[] = [];
		while ((match = timeReg.exec(line)) !== null) {
			const min = parseInt(match[1], 10);
			const sec = parseInt(match[2], 10);
			const ms = match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3], 10);
			timestamps.push(min * 60000 + sec * 1000 + ms);
		}
		const text = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, "").trim();
		if (text && timestamps.length > 0) {
			for (const t of timestamps) {
				result.push({ timeMs: t, text });
			}
		}
	}
	return result.sort((a, b) => a.timeMs - b.timeMs);
}

function parsePlainLyrics(plainText: string): LyricLine[] {
	return plainText
		.split("\n")
		.map((line, idx) => ({ timeMs: idx * 4000, text: line.trim() }))
		.filter((l) => l.text.length > 0);
}

export function CompactMediaPlayer({
	mediaInfo,
	albumArtUrl,
	albumArtKey,
	isPlaying,
	volume,
	volumeExpanded,
	onVolumeExpandedChange,
	onTogglePlayPause,
	onVolumeChange,
	prevFront,
	prevBack,
	nextFront,
	nextBack,
	onAnimatePrev,
	onAnimateNext,
	onLayoutChange
}: CompactMediaPlayerProps) {
	const seekRef = useRef<HTMLInputElement>(null);

	const positionMs = mediaInfo.position_ms ?? 0;
	const durationMs = mediaInfo.duration_ms ?? 0;
	const seekEnabled = mediaInfo.seek_enabled ?? false;
	const positionUpdatedAt = mediaInfo.position_updated_at ?? 0;

	// Single source of truth: last known backend position + when it was received
	const backendPosRef = useRef(positionMs);
	const backendTimeRef = useRef(positionUpdatedAt || Date.now());
	const isSeekingRef = useRef(false);

	// Update refs when backend sends new position (ignore during seek)
	useEffect(() => {
		if (!isSeekingRef.current) {
			backendPosRef.current = positionMs;
			backendTimeRef.current = positionUpdatedAt || Date.now();
		}
	}, [positionMs, positionUpdatedAt]);

	// displayPosition is the live, extrapolated position
	const [displayPosition, setDisplayPosition] = useState(() => {
		const elapsed = Date.now() - (positionUpdatedAt || Date.now());
		return Math.min(positionMs + (isPlaying ? elapsed : 0), durationMs || Infinity);
	});

	// Tick: extrapolate position every 250ms
	useEffect(() => {
		const tick = () => {
			if (isSeekingRef.current) return;
			const elapsed = isPlaying ? Date.now() - backendTimeRef.current : 0;
			const pos = Math.min(backendPosRef.current + elapsed, durationMs || Infinity);
			setDisplayPosition(pos);
		};
		tick();
		const interval = setInterval(tick, 250);
		return () => clearInterval(interval);
	}, [isPlaying, durationMs]);

	// Seek handlers
	const handleSeekStart = useCallback(() => {
		isSeekingRef.current = true;
	}, []);

	const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		setDisplayPosition(Number(e.target.value));
	}, []);

	const handleSeekEnd = useCallback(() => {
		const seekPos = displayPosition;
		isSeekingRef.current = false;
		backendPosRef.current = seekPos;
		backendTimeRef.current = Date.now();
		invoke("media_seek", { positionMs: seekPos }).catch(() => {});
	}, [displayPosition]);

	const progressPercent = durationMs > 0 ? (displayPosition / durationMs) * 100 : 0;

	// Live WIB Date & Time for Header (e.g. Sat 17 Oct 2026 19:13)
	const [headerDateTime, setHeaderDateTime] = useState(() => {
		const now = new Date();
		try {
			const dStr = now.toLocaleDateString("en-US", {
				weekday: "short",
				day: "numeric",
				month: "short",
				year: "numeric",
				timeZone: "Asia/Jakarta"
			});
			const tStr = now.toLocaleTimeString("id-ID", {
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
				timeZone: "Asia/Jakarta"
			});
			return `${dStr} ${tStr}`;
		} catch {
			return now.toLocaleString();
		}
	});

	useEffect(() => {
		const updateHeaderTime = () => {
			const now = new Date();
			try {
				const dStr = now.toLocaleDateString("en-US", {
					weekday: "short",
					day: "numeric",
					month: "short",
					year: "numeric",
					timeZone: "Asia/Jakarta"
				});
				const tStr = now.toLocaleTimeString("id-ID", {
					hour: "2-digit",
					minute: "2-digit",
					hour12: false,
					timeZone: "Asia/Jakarta"
				});
				setHeaderDateTime(`${dStr} ${tStr}`);
			} catch {
				setHeaderDateTime(now.toLocaleString());
			}
		};
		updateHeaderTime();
		const interval = setInterval(updateHeaderTime, 1000);
		return () => clearInterval(interval);
	}, []);

	// Lyrics State & Fetching via LRCLIB
	const [showLyrics, setShowLyrics] = useState(false);
	const [lyrics, setLyrics] = useState<LyricsData | null>(null);
	const [lyricsLoading, setLyricsLoading] = useState(false);
	const [lyricsError, setLyricsError] = useState<string | null>(null);
	const lyricsCache = useRef<Record<string, LyricsData>>({});
	const lyricsContainerRef = useRef<HTMLDivElement>(null);

	const fetchLyrics = useCallback(async () => {
		if (!mediaInfo.title) return;
		const track = mediaInfo.title.trim();
		const artist = (mediaInfo.artist || "").trim();
		const cacheKey = `${artist} - ${track}`;

		if (lyricsCache.current[cacheKey]) {
			setLyrics(lyricsCache.current[cacheKey]);
			setLyricsLoading(false);
			setLyricsError(null);
			return;
		}

		setLyricsLoading(true);
		setLyricsError(null);

		try {
			const cleanTrack = track.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s*\[.*?\]\s*/g, " ").trim();
			const cleanArtist = artist.split(",")[0].split("&")[0].trim();
			const q = new URLSearchParams({
				track_name: cleanTrack || track,
				artist_name: cleanArtist || artist
			});

			const res = await fetch(`https://lrclib.net/api/get?${q.toString()}`, {
				headers: { "User-Agent": "Bloom/3.10" }
			});

			if (!res.ok) {
				throw new Error("Lirik belum tersedia");
			}

			const data = await res.json();
			let lines: LyricLine[] = [];
			let isSynced = false;

			if (data.syncedLyrics) {
				lines = parseLrc(data.syncedLyrics);
				isSynced = true;
			} else if (data.plainLyrics) {
				lines = parsePlainLyrics(data.plainLyrics);
			}

			if (lines.length === 0) {
				throw new Error("Lirik kosong");
			}

			const parsedData = { lines, isSynced };
			lyricsCache.current[cacheKey] = parsedData;
			setLyrics(parsedData);
		} catch (err: any) {
			setLyrics(null);
			setLyricsError("Lirik tidak ditemukan untuk lagu ini");
		} finally {
			setLyricsLoading(false);
		}
	}, [mediaInfo.title, mediaInfo.artist]);

	useEffect(() => {
		if (showLyrics) {
			fetchLyrics();
		}
	}, [showLyrics, fetchLyrics]);

	// Active lyric line index based on current playback ms
	const activeLyricIndex = useMemo(() => {
		if (!lyrics?.lines.length) return -1;
		for (let i = lyrics.lines.length - 1; i >= 0; i--) {
			if (displayPosition >= lyrics.lines[i].timeMs) {
				return i;
			}
		}
		return 0;
	}, [displayPosition, lyrics]);

	// Auto-scroll active lyric into center view
	useEffect(() => {
		if (activeLyricIndex >= 0 && lyricsContainerRef.current) {
			const activeEl = lyricsContainerRef.current.children[activeLyricIndex] as HTMLElement;
			if (activeEl) {
				activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
			}
		}
	}, [activeLyricIndex]);

	return (
		<div className="cmp">
			{/* Top Bar: Live Status Dot + Date Time (WIB) + Visualizer */}
			<div className="cmp-header-status-bar">
				<div className="cmp-status-left">
					<span className={`cmp-live-pulse-dot ${isPlaying ? "playing" : ""}`} />
					<span className="cmp-header-datetime">{headerDateTime}</span>
				</div>
				<div className="cmp-visualizer">
					<Visualizer isPlaying={isPlaying} bars={5} height={14} />
				</div>
			</div>

			{/* Main Row: Cover Art + Title/Artist */}
			<div className="cmp-row cmp-row-info">
				<div
					className="cmp-art"
					onClick={(e) => {
						e.stopPropagation();
						onLayoutChange("classic");
					}}
					style={{ cursor: "pointer" }}
					title="Klik untuk ganti layout"
				>
					<AnimatePresence mode="wait" initial={false}>
						{albumArtUrl ? (
							<motion.img
								key={`art-${albumArtKey}`}
								src={albumArtUrl}
								alt="Art"
								draggable={false}
								initial={{ rotateY: 90, opacity: 0 }}
								animate={{ rotateY: 0, opacity: 1 }}
								exit={{ rotateY: -90, opacity: 0 }}
								transition={{ duration: 0.3, ease: "easeInOut" }}
							/>
						) : (
							<motion.div
								key="placeholder"
								className="cmp-art-placeholder"
								initial={{ rotateY: 90, opacity: 0 }}
								animate={{ rotateY: 0, opacity: 1 }}
								exit={{ rotateY: -90, opacity: 0 }}
								transition={{ duration: 0.3, ease: "easeInOut" }}
							>
								<MusicNoteIcon size={22} />
							</motion.div>
						)}
					</AnimatePresence>
				</div>
				<div className="cmp-track">
					<TitleMarquee title={mediaInfo.title || "No track playing"} />
					<span className="cmp-artist">{mediaInfo.artist || "Unknown Artist"}</span>
				</div>
			</div>

			{/* Progress Row: 01:04 / -01:39 */}
			{durationMs > 0 && (
				<div className="cmp-row cmp-row-progress">
					<span className="cmp-time">{formatTime(displayPosition)}</span>
					<div className="cmp-track-bar">
						<div className="cmp-track-fill" style={{ width: `${progressPercent}%` }} />
						{seekEnabled && (
							<input
								ref={seekRef}
								type="range"
								className="cmp-seek"
								min={0}
								max={durationMs}
								step={100}
								value={displayPosition}
								onMouseDown={handleSeekStart}
								onTouchStart={handleSeekStart}
								onChange={handleSeekChange}
								onMouseUp={handleSeekEnd}
								onTouchEnd={handleSeekEnd}
								onClick={(e) => e.stopPropagation()}
							/>
						)}
					</div>
					<span className="cmp-time">{formatRemaining(displayPosition, durationMs)}</span>
				</div>
			)}

			{/* Controls Row: Lyrics Button + Prev/Play/Next + Volume */}
			<div className="cmp-row cmp-row-controls">
				<motion.button
					className={`cmp-btn cmp-lyrics-toggle-btn ${showLyrics ? "active" : ""}`}
					onClick={(e) => {
						e.stopPropagation();
						setShowLyrics(!showLyrics);
					}}
					whileTap={{ scale: 0.9 }}
					title={showLyrics ? "Tutup Lirik" : "Lihat Lirik Lagu"}
				>
					<MessageSquareText size={16} />
					<span className="cmp-lyrics-btn-text">Lirik</span>
				</motion.button>

				<div className="cmp-main-controls">
					<motion.button
						className="cmp-btn"
						onClick={(e) => {
							e.stopPropagation();
							onAnimatePrev();
						}}
						whileTap={{ scale: 0.9 }}
						title="Lagu Sebelumnya"
					>
						<div className="cmp-slide-wrap">
							<motion.div animate={prevBack} className="cmp-slide-layer">
								<SkipBackIcon size={26} />
							</motion.div>
							<motion.div animate={prevFront} className="cmp-slide-layer">
								<SkipBackIcon size={26} />
							</motion.div>
						</div>
					</motion.button>

					<motion.button
						className="cmp-btn cmp-play"
						onClick={(e) => {
							e.stopPropagation();
							onTogglePlayPause();
						}}
						whileTap={{ scale: 0.95 }}
						title={isPlaying ? "Pause" : "Play"}
					>
						<AnimatePresence mode="wait" initial={false}>
							<motion.div
								key={isPlaying ? "pause" : "play"}
								initial={{ opacity: 0, scale: 0.7 }}
								animate={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0, scale: 0.7 }}
								transition={{ duration: 0.12 }}
								style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
							>
								{isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
							</motion.div>
						</AnimatePresence>
					</motion.button>

					<motion.button
						className="cmp-btn"
						onClick={(e) => {
							e.stopPropagation();
							onAnimateNext();
						}}
						whileTap={{ scale: 0.9 }}
						title="Lagu Berikutnya"
					>
						<div className="cmp-slide-wrap">
							<motion.div animate={nextBack} className="cmp-slide-layer">
								<SkipForwardIcon size={26} />
							</motion.div>
							<motion.div animate={nextFront} className="cmp-slide-layer">
								<SkipForwardIcon size={26} />
							</motion.div>
						</div>
					</motion.button>
				</div>

				<div className="cmp-controls-right">
					<motion.button
						className="cmp-btn cmp-btn-side"
						onClick={(e) => {
							e.stopPropagation();
							onVolumeExpandedChange(!volumeExpanded);
						}}
						whileTap={{ scale: 0.9 }}
						title="Volume"
					>
						<SpeakerIcon size={20} muted={volume === 0} />
					</motion.button>
				</div>
			</div>

			{/* Volume Slider Drawer */}
			<AnimatePresence>
				{volumeExpanded && (
					<motion.div
						className="cmp-expand"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: 36, opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ type: "spring", stiffness: 500, damping: 30 }}
					>
						<div className="cmp-volume-row">
							<VolumeLowIcon size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
							<div className="cmp-volume-track">
								<div className="cmp-volume-fill" style={{ width: `${volume * 100}%` }} />
								<input
									type="range"
									className="cmp-volume-slider"
									min={0}
									max={1}
									step={0.01}
									value={volume}
									onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
									onClick={(e) => e.stopPropagation()}
								/>
							</div>
							<VolumeHighIcon size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			{/* Lyrics Drawer / View */}
			<AnimatePresence>
				{showLyrics && (
					<motion.div
						className="cmp-lyrics-drawer"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: 160, opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ type: "spring", stiffness: 450, damping: 32 }}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="cmp-lyrics-toolbar">
							<div className="cmp-lyrics-header-text">
								<Music size={12} strokeWidth={2.5} />
								<span>Lirik: {mediaInfo.title}</span>
							</div>
							<div className="cmp-lyrics-actions">
								<button
									className="cmp-lyrics-refresh-btn"
									onClick={(e) => {
										e.stopPropagation();
										fetchLyrics();
									}}
									title="Refresh lirik"
								>
									<RefreshCw size={12} className={lyricsLoading ? "spinning" : ""} />
								</button>
								<button
									className="cmp-lyrics-close-btn"
									onClick={(e) => {
										e.stopPropagation();
										setShowLyrics(false);
									}}
									title="Tutup lirik"
								>
									<X size={13} />
								</button>
							</div>
						</div>

						{lyricsLoading ? (
							<div className="cmp-lyrics-state">
								<RefreshCw size={18} className="spinning" />
								<span>Memuat lirik dari LRCLIB...</span>
							</div>
						) : lyricsError ? (
							<div className="cmp-lyrics-state error">
								<span>{lyricsError}</span>
								<button className="cmp-lyrics-retry" onClick={fetchLyrics}>
									Coba Lagi
								</button>
							</div>
						) : lyrics?.lines && lyrics.lines.length > 0 ? (
							<div className="cmp-lyrics-scroll-box" ref={lyricsContainerRef}>
								{lyrics.lines.map((line, idx) => {
									const isActive = idx === activeLyricIndex;
									return (
										<div
											key={idx}
											className={`cmp-lyric-item ${isActive ? "active" : ""}`}
											onClick={() => {
												if (lyrics.isSynced) {
													invoke("media_seek", { positionMs: line.timeMs }).catch(() => {});
												}
											}}
											title={lyrics.isSynced ? "Klik untuk putar dari baris ini" : undefined}
										>
											{line.text}
										</div>
									);
								})}
							</div>
						) : (
							<div className="cmp-lyrics-state">
								<span>Lirik tidak tersedia</span>
							</div>
						)}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
