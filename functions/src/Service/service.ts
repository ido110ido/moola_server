import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { IMeeting } from "../interface/IMeeting";
import { IOpenHours } from "../interface/IService";
import { IScheduleDayFirestore } from "../interface/IScheduleDay";
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
  let currentTime = addTimeStringToDate(date, openHours.startTime);
  const endTime = addTimeStringToDate(date, openHours.endTime);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  //if date is before today, show no available time slots
  if (today > currentTime) {
    return timeSlots;
  }
  //if today thy are try to set a meeting it will show appointment from now flowered
  if (currentTime.getTime() <= Date.now()) {
    currentTime = new Date();
    let minutes: number = Math.floor(currentTime.getMinutes() / 15) * 15 + 15;
    currentTime.setHours(currentTime.getHours(), minutes, 0, 0);
  }
  while (currentTime.getTime() < endTime.getTime()) {
    let isColliding: boolean = false;

    for (let i = 0; i < meetings.length; i++) {
      const meeting = meetings[i];

      if (isMeetingsColliding(currentTime, meeting)) {
        isColliding = true;
        const meetingEndTime: Date = new Date(
          new Date(meeting.start).getTime() + meeting.durationInMinutes * 60000
        );
        meetings.splice(i, 1);
        currentTime = meetingEndTime;
        break;
      }
    }

    if (!isColliding) {
      let minutes: string = currentTime.getMinutes().toString();
      if (currentTime.getMinutes() === 0) {
        minutes = "00";
      }
      const formattedTime: string = currentTime.getHours() + ":" + minutes;
      timeSlots.push(formattedTime);
      currentTime = new Date(currentTime.getTime() + serviceDuration * 60000);
    }
  }

  return timeSlots;
};
const isMeetingsColliding = (newMeetingStart: Date, existingMeeting: IMeeting): boolean => {
  const meetingStartTime = new Date(existingMeeting.start);
  const meetingEndTime = new Date(
    meetingStartTime.getTime() + existingMeeting.durationInMinutes * 60000
  );
  const newMeetingEnd = new Date(
    newMeetingStart.getTime() + existingMeeting.durationInMinutes * 60000
  );

  if (newMeetingStart >= meetingStartTime && newMeetingStart < meetingEndTime) {
    return true;
  }

  if (newMeetingEnd > meetingStartTime && newMeetingEnd <= meetingEndTime) {
    return true;
  }

  if (newMeetingStart.getTime() === meetingStartTime.getTime()) {
    return true;
  }

  return false;
};
const addTimeStringToDate = (date: Date, timeString: string): Date => {
  const [hours, minutes] = timeString.split(":").map(Number);
  const currentDate = new Date(date);
  currentDate.setHours(hours);
  currentDate.setMinutes(minutes);
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
  console.log("Previous month:", previousMonth);
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
    const lastMonthIncome: number = stats.last5month[stats.last5month.length - 1].income;
    const last2MonthIncome: number = stats.last5month[stats.last5month.length - 2].income;
    stats.MTM = ((lastMonthIncome - last2MonthIncome) / last2MonthIncome) * 100;
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
      (sum: number, crr) => (crr.durationInMinutes === 9999 ? sum++ : sum),
      0
    );
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
