type ProtectiveModeState = {
  enabled: boolean;
  level: "NORMAL" | "ELEVATED" | "LOCKDOWN";
};

const state: ProtectiveModeState = {
  enabled: false,
  level: "NORMAL",
};

export const protectiveModeService = {
  getState(): ProtectiveModeState {
    return { ...state };
  },
  setLevel(level: ProtectiveModeState["level"]) {
    state.enabled = level !== "NORMAL";
    state.level = level;
  },
};