import { create } from 'zustand';

export interface HealthSyncLog {
  id: string;
  timestamp: string;
  recordCount: number;
  status: 'success' | 'error';
  message?: string;
}

interface HealthSyncStore {
  logs: HealthSyncLog[];
  addLog: (log: Omit<HealthSyncLog, 'id'>) => void;
  clearLogs: () => void;
}

export const useHealthSyncStore = create<HealthSyncStore>((set) => ({
  logs: [],
  addLog: (log) => set((state) => {
    const newLog = { ...log, id: Math.random().toString(36).substr(2, 9) };
    // Keep only the last 50 logs in memory
    const updatedLogs = [newLog, ...state.logs].slice(0, 50);
    return { logs: updatedLogs };
  }),
  clearLogs: () => set({ logs: [] }),
}));
