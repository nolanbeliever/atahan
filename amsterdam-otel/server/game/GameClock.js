import {
  DAY_START_MIN, DAY_END_MIN, CHECKIN_OPEN_MIN, CHECKIN_CLOSE_MIN, MINUTES_PER_DAY, isWeekend,
} from '../../shared/constants.js';

/**
 * Haftalık gün döngüsü.
 *  - Pazartesi–Cuma: otel açık, 08:00–19:00 arası misafir kabul edilir.
 *  - Cumartesi–Pazar: otel kapalı (hafta sonu modu), zaman daha hızlı akar.
 * `total` gün sayısını da içeren mutlak oyun dakikasıdır; konaklama bitişleri
 * bununla karşılaştırılır, böylece gece yarısını aşan konaklamalar doğal
 * olarak ertesi sabah sona erer.
 */
export class GameClock {
  constructor({ dayLengthSec, weekendSpeed, startDay = 0, startMinute = DAY_START_MIN }) {
    this.dayLengthSec = dayLengthSec;
    this.weekendSpeed = weekendSpeed;
    this.dayCount = startDay; // mutlak gün sayacı (0 = ilk Pazartesi)
    this.minute = startMinute;
  }

  get dayOfWeek() { return this.dayCount % 7; }
  get week() { return Math.floor(this.dayCount / 7) + 1; }
  get weekend() { return isWeekend(this.dayOfWeek); }
  get total() { return this.dayCount * MINUTES_PER_DAY + this.minute; }

  /** Oyun dakikası / gerçek saniye */
  get rate() {
    const base = (DAY_END_MIN - DAY_START_MIN) / this.dayLengthSec;
    return this.weekend ? base * this.weekendSpeed : base;
  }

  /** Otel misafir kabul ediyor mu? */
  get checkinOpen() {
    return !this.weekend && this.minute >= CHECKIN_OPEN_MIN && this.minute < CHECKIN_CLOSE_MIN;
  }

  /** @returns {boolean} gün değişti mi */
  advance(dtSec) {
    this.minute += dtSec * this.rate;
    if (this.minute < DAY_END_MIN) return false;
    this.dayCount += 1;
    this.minute = DAY_START_MIN;
    return true;
  }

  snapshot(serverNow) {
    return {
      day: this.dayOfWeek,
      week: this.week,
      minute: this.minute,
      rate: this.rate,
      weekend: this.weekend,
      open: this.checkinOpen,
      st: serverNow,
    };
  }
}
