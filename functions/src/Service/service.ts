import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { IMeeting } from "../interface/IMeeting";
import { IOpenHours } from "../interface/IService";
import { IScheduleDay, IScheduleDayFirestore } from "../interface/IScheduleDay";
import { IDayStats, ILast5month, IStats } from "../interface/Istats";
import { QuerySnapshot } from "firebase-admin/firestore";
import { INotification } from "../interface/INotification";
admin.initializeApp(functions.config().firebase); // Initialize Firebase Admin SDK

if (!admin.apps.length) {
  admin.initializeApp(); // Initialize the default Firebase app
}

const firestore = admin.firestore();

export const getMeetings = async (userId: string, date: Date): Promise<IMeeting[]> => {
  const userDocRef = firestore.collection("Users").doc(userId);
  const scheduleDaysCollection = userDocRef.collection("ScheduleDays");

  const querySnapshot = await scheduleDaysCollection.where("date", "==", date).limit(1).get();
  if (querySnapshot.empty) {
    return [];
  }
  return querySnapshot.docs[0].data().meetings || [];
};

//generate meeting time Slots
export const generateTimeSlots = (
  date: Date,
  serviceDuration: number,
  openHours: IOpenHours,
  meetings: IMeeting[]
): string[] => {
  let timeSlots: string[] = [];

  let startTime = addTimeStringToDate(date, openHours.startTime);
  const endTime = addTimeStringToDate(date, openHours.endTime);

  let today = new Date();
  today.setHours(0, 0, 0, 0);
  //if date is before today, show no available time slots or is a day off
  if (today.getTime() > startTime.getTime()) {
    return timeSlots;
  }
  //if today they are try to set a meeting it will show appointment from now flowered
  today.setHours(date.getHours(), date.getMinutes(), 0, 0);
  if (startTime.getTime() <= today.getTime()) {
    startTime = today;
    let minutes: number = Math.ceil(today.getMinutes() / 10) * 10 + 15;
    startTime.setHours(startTime.getHours(), minutes, 0, 0);
  }

  while (startTime.getTime() < endTime.getTime()) {
    let isColliding: boolean = false;
    for (let i = 0; i < meetings.length; i++) {
      const meeting = meetings[i];
      if (isMeetingsColliding(startTime, meeting)) {
        isColliding = true;
        const meetingEndTime: Date = stringToDate(meeting.start);
        meetingEndTime.setMinutes(meetingEndTime.getMinutes() + meeting.durationInMinutes);
        meetings.splice(i, 1);
        startTime = meetingEndTime;
        break;
      }
    }

    if (!isColliding) {
      timeSlots.push(timeSlotText(startTime));
      startTime.setMinutes(startTime.getMinutes() + serviceDuration);
    }
  }

  return timeSlots;
};
const timeSlotText = (time: Date): string => {
  let minutes: string = time.getMinutes().toString();
  if (time.getMinutes() === 0) {
    minutes = "00";
  } else if (time.getMinutes() < 10) {
    minutes = "0" + minutes;
  }
  return time.getHours() + ":" + minutes;
};
const isMeetingsColliding = (newMeetingStart: Date, existingMeeting: IMeeting): boolean => {
  const meetingStartTime = stringToDate(existingMeeting.start);
  const meetingEndTime = new Date(
    meetingStartTime.getTime() + existingMeeting.durationInMinutes * 60000
  );
  const newMeetingEndTime = new Date(
    newMeetingStart.getTime() + existingMeeting.durationInMinutes * 60000
  );
  // Check if the new meeting starts within the existing meeting
  if (newMeetingStart >= meetingStartTime && newMeetingStart < meetingEndTime) {
    return true;
  }

  // Check if the new meeting ends within the existing meeting
  if (newMeetingEndTime > meetingStartTime && newMeetingEndTime <= meetingEndTime) {
    return true;
  }

  // Check if the new meeting spans the entire existing meeting
  if (newMeetingStart <= meetingStartTime && newMeetingEndTime >= meetingEndTime) {
    return true;
  }

  // No overlap found
  return false;
};
const addTimeStringToDate = (date: Date, timeString: string): Date => {
  const [hours, minutes] = timeString.split(":").map(Number);
  const currentDate = new Date(date);
  currentDate.setHours(hours, minutes);
  currentDate.setSeconds(0, 0);
  return currentDate;
};
//********************************************************* */
//calculate the stats of the current month
export const createMonthStats = async (
  startDate: Date,
  querySnapshot: QuerySnapshot<IScheduleDayFirestore>,
  userId: string
): Promise<IStats> => {
  const userDocRef = firestore.collection("Users").doc(userId);
  const statsCollection = userDocRef.collection("Stats");
  const stats: IStats = calculateMonthStats(querySnapshot);
  stats.date = startDate;

  //calculate previous 5 months
  const previousMonth = new Date(startDate.getFullYear(), startDate.getMonth() - 1, 1);
  const previousMonthStat = await statsCollection.where("date", "==", previousMonth).limit(1).get();
  if (!previousMonthStat.empty) {
    const previousData = previousMonthStat.docs[0].data() as IStats;
    const monthSummery: ILast5month = {
      month: previousMonth,
      income: previousData.income,
    };
    let last5month: ILast5month[] = [monthSummery, ...previousData.last5month];
    if (last5month.length > 5) {
      last5month = last5month.slice(0, 5);
    }
    stats.last5month = last5month;
  }
  //calculate MTM
  if (stats.last5month.length > 1) {
    const lastMonthIncome: number = stats.last5month[0].income;
    const last2MonthIncome: number = stats.last5month[1].income;
    // Check for valid values before performing the calculation
    if (!isNaN(lastMonthIncome) && !isNaN(last2MonthIncome) && last2MonthIncome !== 0) {
      stats.MTM = ((lastMonthIncome - last2MonthIncome) / last2MonthIncome) * 100;
    } else {
      // Handle the case where the calculation cannot be performed
      stats.MTM = 0;
    }
  }

  return stats;
};
const calculateMonthStats = (querySnapshot: QuerySnapshot<IScheduleDayFirestore>): IStats => {
  const stats: IStats = {
    date: new Date(),
    meetingNum: 0,
    income: 0,
    last5month: [],
    MTM: 0,
    siteVisit: 0,
    daysStats: [],
    newCustomers: 0,
  };
  const dayOfWeekStatsMap: Map<number, IDayStats> = new Map();
  querySnapshot.forEach((doc) => {
    const scheduleDay = doc.data() as IScheduleDayFirestore;
    const dayMeetings = scheduleDay.meetings || [];
    const dateTimeStamp = scheduleDay.date.toDate();
    const dayOfWeek = dateTimeStamp.getDay();
    const timeOff = dayMeetings.reduce(
      (sum: number, crr) =>
        crr.serviceName == "Vacation" || crr.serviceName == "timeOut" ? sum + 1 : sum,
      0
    );
    console.log("timeOff: " + timeOff);
    if (dayMeetings.length - timeOff === 0) {
      return;
    }

    if (dayOfWeekStatsMap.has(dayOfWeek)) {
      const existingStats = dayOfWeekStatsMap.get(dayOfWeek)!;
      existingStats.dayIncome += dayMeetings.reduce(
        (total: number, meeting: IMeeting) => total + meeting.price,
        0
      );
      existingStats.meetingNum += dayMeetings.length - timeOff;
      dayOfWeekStatsMap.set(dayOfWeek, existingStats);
    } else {
      const dayStats: IDayStats = {
        day: dayOfWeek + 1,
        dayIncome: dayMeetings.reduce(
          (total: number, meeting: IMeeting) => total + meeting.price,
          0
        ),
        meetingNum: dayMeetings.length - timeOff,
      };
      dayOfWeekStatsMap.set(dayOfWeek, dayStats);
    }
  });
  stats.daysStats = Array.from(dayOfWeekStatsMap.values());
  // Calculate the number of meetings and the total profit amount
  stats.meetingNum = Array.from(dayOfWeekStatsMap.values()).reduce(
    (total: number, stats) => total + stats.meetingNum,
    0
  );
  stats.income = Array.from(dayOfWeekStatsMap.values()).reduce(
    (total: number, stats) => total + stats.dayIncome,
    0
  );

  return stats;
};
//**************************************** */
// Define the Cloud Function
export const addNotification = async (userId: string, notification: INotification) => {
  try {
    const userRef = admin.firestore().collection("Users").doc(userId);
    const notificationsRef = userRef.collection("Notifications");

    // Get the total number of notifications
    const notificationsSnapshot = await notificationsRef.get();
    const notificationCount = notificationsSnapshot.size;

    // If the limit is already reached, remove the oldest notification
    if (notificationCount >= 20) {
      const oldestNotification = notificationsSnapshot.docs[0];
      await oldestNotification.ref.delete();
    }

    // Add the new notification document with an auto-generated ID
    await notificationsRef.add(notification);

    console.log("Notification added successfully.");

    return { success: true };
  } catch (error) {
    console.error("Error adding notification:", error);
    throw new functions.https.HttpsError(
      "internal",
      "An error occurred while adding the notification."
    );
  }
};
export const addMeeting = async (userId: string, meeting: IMeeting, date: Date) => {
  try {
    const userDocRef = firestore.collection("Users").doc(userId);
    const scheduleDaysCollection = userDocRef.collection("ScheduleDays");
    const querySnapshot = await scheduleDaysCollection.where("date", "==", date).limit(1).get();
    let scheduleDayDoc: admin.firestore.DocumentReference;
    if (querySnapshot.empty) {
      // Create a new ScheduleDay document if none exists for the date
      const newScheduleDay: IScheduleDay = {
        date: date,
        isDayOff: false,
        meetings: [meeting],
        updatedAt: Date.now(),
      };

      scheduleDayDoc = await scheduleDaysCollection.add(newScheduleDay);
    } else {
      // Add the meeting to the existing ScheduleDay document
      scheduleDayDoc = querySnapshot.docs[0].ref;
      const existingMeetings = querySnapshot.docs[0].data().meetings || [];
      const updatedMeetings = [...existingMeetings, meeting].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      );
      await scheduleDayDoc.update({ meetings: updatedMeetings, updatedAt: Date.now() });
    }
    //add notification
    const notification: INotification = {
      date: date,
      title: "New Meeting Added",
      customerName: meeting.customerName,
      color: meeting.color,
      addedDate: new Date(Date.now()),
    };

    await addNotification(userId, notification);

    return { success: true };
  } catch (error) {
    console.error("Error adding meeting:", error);
    throw new functions.https.HttpsError("internal", "An error occurred while adding the meeting.");
  }
};

//*********************** */

export const stringToDate = (dateString: string): Date => {
  // Parse existing meeting's start time string
  const [dateComponent, timeComponent] = dateString.split("T");
  const [hours, minutes] = timeComponent.split(":");
  // Create a new Date object with the parsed components
  const meetingStartTime = new Date(dateComponent);
  meetingStartTime.setHours(parseInt(hours), parseInt(minutes));
  return meetingStartTime;
};
