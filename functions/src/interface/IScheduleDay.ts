import { Timestamp } from "firebase-admin/firestore";
import { IMeeting } from "./IMeeting";

export interface IScheduleDay {
  date: Date;
  updatedAt: number;
  isDayOff: boolean;
  meetings: IMeeting[];
}

export interface IScheduleDayFirestore {
  date: Timestamp;
  updatedAt: number;
  isDayOff: boolean;
  meetings: IMeeting[];
}
