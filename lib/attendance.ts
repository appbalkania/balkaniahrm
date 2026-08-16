import type { AttendanceEventType, AttendanceState } from "./domain";

const validTransitions: Record<AttendanceState, AttendanceEventType[]> = {
  not_started: ["clock_in"],
  working: ["clock_out", "break_start", "lunch_start"],
  on_break: ["break_end"],
  on_lunch: ["lunch_end"],
  complete: [],
};

const nextState: Record<AttendanceEventType, AttendanceState> = {
  clock_in: "working", clock_out: "complete", break_start: "on_break",
  break_end: "working", lunch_start: "on_lunch", lunch_end: "working",
};

export function canRecordAttendanceEvent(state: AttendanceState, eventType: AttendanceEventType) {
  return validTransitions[state].includes(eventType);
}

export function transitionAttendanceState(state: AttendanceState, eventType: AttendanceEventType): AttendanceState {
  if (!canRecordAttendanceEvent(state, eventType)) throw new Error(`Cannot record ${eventType} while attendance is ${state}.`);
  return nextState[eventType];
}

export function eventLabel(eventType: AttendanceEventType) {
  return eventType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
