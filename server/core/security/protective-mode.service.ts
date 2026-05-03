import { systemState } from "../state/system-state";

export const protectiveModeService = {
  getState() {
    const level = systemState.get().protectiveMode;
    return { enabled: level !== "NORMAL", level };
  },
  setLevel(level: "NORMAL" | "ELEVATED" | "LOCKDOWN") {
    systemState.setProtectiveMode(level);
  },
};
