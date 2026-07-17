import { CAREER_SAVE_KEY } from '../game/config/constants';
import { normalizeCareer, type CareerState } from '../progression/CareerState';

export class SaveService {
  public load(): CareerState {
    try {
      const serialized = localStorage.getItem(CAREER_SAVE_KEY);
      if (serialized === null) {
        return normalizeCareer(null);
      }
      return normalizeCareer(JSON.parse(serialized) as Partial<CareerState>);
    } catch {
      return normalizeCareer(null);
    }
  }

  public save(career: CareerState): void {
    career.lastSavedAt = new Date().toISOString();
    try {
      localStorage.setItem(CAREER_SAVE_KEY, JSON.stringify(career));
    } catch {
      // The current session remains playable when storage is blocked.
    }
  }

  public clear(): void {
    try {
      localStorage.removeItem(CAREER_SAVE_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }
}
