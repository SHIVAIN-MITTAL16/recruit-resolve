/**
 * Tiny leveled logger. Buffers entries so the UI can show what happened
 * during the transform without us reaching for the console.
 */
export type LogLevel = "INFO" | "WARNING" | "ERROR";
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
}

export class Logger {
  private entries: LogEntry[] = [];
  log(level: LogLevel, message: string) {
    this.entries.push({ level, message, timestamp: new Date().toISOString() });
  }
  info(m: string) {
    this.log("INFO", m);
  }
  warn(m: string) {
    this.log("WARNING", m);
  }
  error(m: string) {
    this.log("ERROR", m);
  }
  all() {
    return [...this.entries];
  }
}
