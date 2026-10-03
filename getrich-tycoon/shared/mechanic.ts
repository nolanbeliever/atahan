// The part-time mechanic (Tamirci) at the Sanayi: "Tamirci Olarak Çalış (E)" at the job board by
// the hall's door starts a shift. Customers' damaged cars come in one after another and go up on a
// free lift; fix the engine (smoking under the bonnet), the body (bumper and door hanging off) and
// the tyres, each at its spot round the car; the customer pays $1,000 on the spot, the car goes, the
// next one comes in.

import { ECONOMY } from './economy.config';
import { SANAYI } from './sanayiLayout';
import { LIFT_BAYS } from './theft';

export type RepairTask = 'engine' | 'body' | 'tyres';
export const REPAIR_TASKS: RepairTask[] = ['engine', 'body', 'tyres'];

export const TASK_LABEL: Record<RepairTask, string> = {
  engine: 'Motoru Onar',
  body: 'Kaportayı Düzelt',
  tyres: 'Lastikleri Değiştir',
};

/** The job board ("TAMİRCİ ARANIYOR") on the hall's west wall by the office: stand in front of it. */
export const JOB_BOARD = { x: SANAYI.hall.minX + 1.8, z: 177.5, radius: 2.6 };

/** The middle of the hall (a shift ends when you go too far from it). */
export const HALL_CENTRE = { x: (SANAYI.hall.minX + SANAYI.hall.maxX) / 2, z: (SANAYI.hall.minZ + SANAYI.hall.maxZ) / 2 };

/** Where you stand for a job on a car on a lift (bay along +z, the car facing +z): the engine
 *  in front of the bonnet, the body by the driver's door, the tyres at a rear wheel. */
export function taskPoint(bay: number, task: RepairTask, length: number, width: number): { x: number; z: number } {
  const b = LIFT_BAYS[bay]!;
  if (task === 'engine') return { x: b.x, z: b.z + length / 2 + 0.7 };
  if (task === 'body') return { x: b.x + width / 2 + 0.75, z: b.z + 1 };
  return { x: b.x - width / 2 - 0.75, z: b.z - length / 2 + 0.8 };
}

/** A car on a lift for repair (everyone sees it). */
export interface RepairCar {
  id: string;
  /** The mechanic it is for. */
  forId: string;
  bay: number;
  modelId: string;
  color: string;
  /** Whose car (flavour). */
  owner: string;
  /** When it went up (ms): the lift rises over a couple of seconds. */
  upAt: number;
  /** Jobs still to do. */
  todo: RepairTask[];
}

/** The mechanic's shift as they see it. */
export interface MechanicView {
  onDuty: boolean;
  car: RepairCar | null;
  /** The job going on and when it is done (ms). */
  working: { task: RepairTask; until: number; sec: number } | null;
  /** This shift: cars done and money earned; when the next car comes (ms). */
  cars: number;
  earned: number;
  nextAt: number | null;
}

export const MECH = ECONOMY.mechanic;
