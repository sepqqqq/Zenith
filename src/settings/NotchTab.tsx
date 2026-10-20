import {
	PanelTop,
	Calendar,
	BellRing,
	Music,
	Minimize2
} from "lucide-react";
import { SettingRow } from "./SettingRow";

interface NotchTabProps {
	notchMode: string;
	setNotchModeValue: (mode: string) => void;
	calendarEnabled: boolean;
	toggleCalendar: () => void;
	timerSoundEnabled: boolean;
	toggleTimerSound: () => void;
	musicModeEnabled: boolean;
	toggleMusicMode: () => void;
	musicCompactNotch: boolean;
	toggleMusicCompactNotch: () => void;
}

export function NotchTab({
	notchMode,
	setNotchModeValue,
	calendarEnabled,
	toggleCalendar,
	timerSoundEnabled,
	toggleTimerSound,
	musicModeEnabled,
	toggleMusicMode,
	musicCompactNotch,
	toggleMusicCompactNotch
}: NotchTabProps) {
	return (
		<div className="tab-pane notch-pane">
			<div className="setting-group-label">Notch Behavior</div>
			<div className="setting-group">
				<SettingRow
					icon={PanelTop}
					label="Notch Mode"
					desc="Control when the dynamic island reveals itself"
				>
					<div className="segmented-control">
						{(["smart", "fixed", "peek"] as const).map((m) => (
							<button
								key={m}
								className={`segmented-btn ${notchMode === m ? "active" : ""}`}
								onClick={() => setNotchModeValue(m)}
							>
								{m.toUpperCase()}
							</button>
						))}
					</div>
				</SettingRow>

				<SettingRow icon={Calendar} label="Calendar & Timer" desc="Productivity timer & focus tool">
					<label className="toggle-switch">
						<input type="checkbox" checked={calendarEnabled} onChange={toggleCalendar} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				{calendarEnabled && (
					<SettingRow
						icon={BellRing}
						label="Timer Sound"
						desc="Play audio alert when countdown finishes"
					>
						<label className="toggle-switch">
							<input type="checkbox" checked={timerSoundEnabled} onChange={toggleTimerSound} />
							<span className="slider"></span>
						</label>
					</SettingRow>
				)}

				<SettingRow icon={Music} label="Music Mode" desc="Live media playback & synced lyrics widget">
					<label className="toggle-switch">
						<input type="checkbox" checked={musicModeEnabled} onChange={toggleMusicMode} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				{musicModeEnabled && (
					<SettingRow
						icon={Minimize2}
						label="Compact Mode"
						desc="Compact display showing weather, time WIB & battery"
						divider={false}
					>
						<label className="toggle-switch">
							<input
								type="checkbox"
								checked={musicCompactNotch}
								onChange={toggleMusicCompactNotch}
							/>
							<span className="slider"></span>
						</label>
					</SettingRow>
				)}
			</div>
		</div>
	);
}
