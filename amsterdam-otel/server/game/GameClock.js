import {
  DAY_START_MIN, DAY_END_MIN, CHECKIN_OPEN_MIN, CHECKIN_CLOSE_MIN, MINUTES_PER_DAY, isWeekend,
} from '../../shared/constants.js';

const NIGHT_MINUTES = MINUTES_PER_DAY - DAY_END_MIN + DAY_START_MIN; // 23:00 → 07:00 = 480
const NIGHT_END = DAY_END_MIN + NIGHT_MINUTES; // 31:00 = ertesi gün 07:00

/**
 * Haftalık gün döngüsü.
 *  - Pazartesi–Cuma: otel açık, 08:00–19:00 arası misafir kabul edilir.
 *  - Cumartesi–Pazar: otel kapalı (hafta sonu modu), zaman daha hızlı akar.
 * `total` gün sayısını da içeren mutlak oyun dakikasıdır; konaklama bitişleri
 * bununla karşılaştırılır, böylece gece yarısını aşan konaklamalar doğal
 * olarak ertesi sabah sona erer.
 */
export class GameClock {
  /**
   * @param nightLengthSec gecenin (23:00 → 07:00) gerçek süresi; 0 ise gece atlanır
   *   (23:00'te doğrudan ertesi sabaha geçilir). Gece boyunca otel kapalıdır; oyuncular
   *   evlerinde uyuyunca (sleepThrough) sabah erken gelir.
   */
  constructor({ dayLengthSec, weekendSpeed, nightLengthSec = 0, startDay = 0, startMinute = DAY_START_MIN }) {
    this.dayLengthSec = dayLengthSec;
    this.weekendSpeed = weekendSpeed;
    this.nightLengthSec = nightLengthSec;
    this.dayCount = startDay; // mutlak gün sayacı (0 = ilk Pazartesi)
    this.minute = startMinute;
  }

  get dayOfWeek() { return this.dayCount % 7; }
  get week() { return Math.floor(this.dayCount / 7) + 1; }
  get weekend() { return isWeekend(this.dayOfWeek); }
  get total() { return this.dayCount * MINUTES_PER_DAY + this.minute; }

  /** Gece mi (23:00 → 07:00). minute gece boyunca 23:00'ten 31:00'e (ertesi 07:00) kadar sayar. */
  get night() { return this.minute >= DAY_END_MIN; }

  /** Oyun dakikası / gerçek saniye */
  get rate() {
    if (this.night) return this.nightLengthSec > 0 ? NIGHT_MINUTES / this.nightLengthSec : 0;
    const base = (DAY_END_MIN - DAY_START_MIN) / this.dayLengthSec;
    return this.weekend ? base * this.weekendSpeed : base;
  }

  /** Otel misafir kabul ediyor mu? */
  get checkinOpen() {
    return !this.weekend && this.minute >= CHECKIN_OPEN_MIN && this.minute < CHECKIN_CLOSE_MIN;
  }

  /** @returns {boolean} gün değişti mi */
  advance(dtSec) {
    if (this.night) {
      this.minute += dtSec * this.rate;
      if (this.minute < NIGHT_END) return false;
      return this.sleepThrough();
    }
    this.minute += dtSec * this.rate;
    if (this.minute < DAY_END_MIN) return false;
    if (this.nightLengthSec > 0) {
      this.minute = DAY_END_MIN; // gece başlar (gün henüz değişmez)
      return false;
    }
    return this.sleepThrough();
  }

  /** Sabah: ertesi gün 07:00 (herkes uyuyunca gece erken biter). @returns {true} */
  sleepThrough() {
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
      night: this.night,
      days: this.dayCount, // mutlak gün (bahçe büyümesi: days * 1440 + minute)
      st: serverNow,
    };
  }
}
