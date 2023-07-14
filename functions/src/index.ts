import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { IOpenHours } from "./interface/IService";
import {
  addNotification,
  createMonthStats,
  generateTimeSlots,
  getMeetings,
} from "./Service/service";
import { IMeeting } from "./interface/IMeeting";
import { IScheduleDay, IScheduleDayFirestore } from "./interface/IScheduleDay";
import { IStats } from "./interface/Istats";
import { QuerySnapshot } from "firebase-admin/firestore";
import { INotification } from "./interface/INotification";

if (!admin.apps.length) {
  admin.initializeApp(); // Initialize the default Firebase app
}

const firestore = admin.firestore();

exports.addMeeting = functions.https.onCall(async (data, context) => {
  try {
    const meeting: IMeeting = data.meeting;
    const userId = data.userId;
    const date = new Date(meeting.start);
    const _date = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const userDocRef = firestore.collection("Users").doc(userId);
    const scheduleDaysCollection = userDocRef.collection("ScheduleDays");
    const querySnapshot = await scheduleDaysCollection.where("date", "==", _date).limit(1).get();
    let scheduleDayDoc: admin.firestore.DocumentReference;

    if (querySnapshot.empty) {
      // Create a new ScheduleDay document if none exists for the date
      const newScheduleDay: IScheduleDay = {
        date: _date,
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
      date: _date,
      title: "New Meeting Added",
      customerName: meeting.customerName,
      color: meeting.color,
      addedDate: new Date(Date.now()),
    };

    await addNotification(userId, notification);
    return { success: true, scheduleDayId: scheduleDayDoc.id };
  } catch (error: any) {
    console.error("Error adding meeting:", error.message);
    return { success: false, error: error.message };
  }
});

exports.delateMeeting = functions.https.onCall(async (data, context) => {
  try {
    const meeting: IMeeting = data.meeting;
    const userId = data.userId;
    const date = new Date(meeting.start);
    const _date = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const userDocRef = firestore.collection("Users").doc(userId);
    const scheduleDaysCollection = userDocRef.collection("ScheduleDays");
    const querySnapshot = await scheduleDaysCollection.where("date", "==", _date).limit(1).get();
    let scheduleDayDoc: admin.firestore.DocumentReference;

    scheduleDayDoc = querySnapshot.docs[0].ref;
    const existingMeetings: IMeeting[] = querySnapshot.docs[0].data().meetings || [];
    const updatedMeetings = existingMeetings.filter(
      (meet) => new Date(meet.start).getTime() !== date.getTime()
    );
    await scheduleDayDoc.update({ meetings: updatedMeetings, updatedAt: Date.now() });

    //add notification
    const notification: INotification = {
      date: _date,
      title: "Meeting Was Deleted",
      customerName: meeting.customerName,
      color: meeting.color,
      addedDate: new Date(Date.now()),
    };
    await addNotification(userId, notification);
    return { success: true, scheduleDayId: scheduleDayDoc.id };
  } catch (error: any) {
    console.error("Error adding meeting:", error.message);
    return { success: false, error: error.message };
  }
});

exports.timeSlotsGenerate = functions.https.onCall(async (data, context) => {
  try {
    const userId: string = data.userId;
    const date: Date = new Date(data.date);
    const serviceDuration: number = data.serviceDuration;
    const openHours: IOpenHours = data.openHours;

    const _date = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const meetings: IMeeting[] = await getMeetings(userId, _date);
    const timeSlots: string[] = generateTimeSlots(_date, serviceDuration, openHours, meetings);

    return { success: true, timeSlotList: timeSlots };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

exports.addVacationMeeting = functions.https.onCall(async (data, context) => {
  try {
    const userId: string = data.userId;
    const startDate: Date = new Date(data.startDate);
    const endDate: Date = new Date(data.endDate);

    const userDocRef = firestore.collection("Users").doc(userId);
    const scheduleDaysCollection = userDocRef.collection("ScheduleDays");

    // Add vacation meetings to all the available dates
    const vacationMeeting: IMeeting = {
      customerName: "Vacation",
      phoneNumber: "",
      serviceName: "Vacation",
      serviceDescription: "Vacation",
      start: "", // You can set the start time if needed
      price: 0,
      durationInMinutes: 9999,
      color: 0,
    };

    while (startDate <= endDate) {
      let currentVacationMeeting: IMeeting = vacationMeeting;
      currentVacationMeeting["start"] = startDate.toISOString();
      const scheduleDay: IScheduleDay = {
        date: startDate,
        isDayOff: true,
        meetings: [currentVacationMeeting],
        updatedAt: Date.now(),
      };
      await scheduleDaysCollection.add(scheduleDay);
      startDate.setDate(startDate.getDate() + 1);
    }

    return { success: true };
  } catch (error: any) {
    console.error("Error adding vacation meetings:", error.message);
    return { success: false, message: error.message };
  }
});

exports.selectedMonthStatistic = functions.https.onCall(async (data: any, context) => {
  try {
    // Inputs
    const userId: string = data.userId;
    const dateString: string = data.date;
    const previousCall: number = data.previousCall;
    const date = new Date(dateString);

    // // Get the start and end dates of the month
    const startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    // startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    // endDate.setHours(23, 59, 59, 999);
    const userDocRef = firestore.collection("Users").doc(userId);

    // // // Collections
    const scheduleDaysCollection = userDocRef.collection("ScheduleDays");
    const statsCollection = userDocRef.collection("Stats");

    // // // Check if there are any updates in the schedules for this month
    const querySnapshot: QuerySnapshot<IScheduleDayFirestore> = (await scheduleDaysCollection
      .where("date", ">=", startDate)
      .where("date", "<=", endDate)
      .get()) as QuerySnapshot<IScheduleDayFirestore>;

    // Store the timestamp of the current fetch

    // Check if any document has changes
    const changesDetected = querySnapshot.docs.filter(
      (document) => document.data()["updatedAt"] > previousCall
    );
    const statSnapshot = await statsCollection.where("date", "==", startDate).limit(1).get();

    // // If there are no updates and the stats exist, return the existing stats
    if (changesDetected.length === 0 && !statSnapshot.empty) {
      const existingStats = statSnapshot.docs[0].data();
      return { success: true, stats: existingStats, fromMemory: true };
    }

    // // Create new stats
    const stats: IStats = await createMonthStats(startDate, querySnapshot, userId);

    if (!statSnapshot.empty) {
      const statsId = statSnapshot.docs[0].id;
      await statsCollection.doc(statsId).update({
        meetingNum: stats.meetingNum,
        income: stats.income,
        last5month: stats.last5month,
        daysStats: stats.daysStats,
        MTM: stats.MTM,
        siteVisit: stats.siteVisit,
      });
    } else {
      await statsCollection.add(stats);
    }
    return {
      success: true,
      stats: {
        ...stats,
        date: {
          _seconds: Math.floor(stats.date.getTime() / 1000),
          _nanoseconds: 0,
        },
      },
      fromMemory: false,
    };
  } catch (error: any) {
    console.error("Error getting stats meetings:", error.message);
    return { success: false, message: error.message };
  }
});

exports.updatedNewCustomerCounter = functions.firestore
  .document("Users/{userId}/Customers/{customerId}")
  .onCreate(async (snapshot, context) => {
    const userId = context.params.userId;
    const startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    // // // Collections
    const userDocRef = firestore.collection("Users").doc(userId);
    const statsCollection = userDocRef.collection("Stats");
    const statSnapshot = await statsCollection.where("date", "==", startDate).limit(1).get();

    if (!statSnapshot.empty) {
      const existingStats = statSnapshot.docs[0].data() as IStats;
      const statsId = statSnapshot.docs[0].id;
      await statsCollection.doc(statsId).update({
        newCustomers: existingStats.newCustomers + 1,
      });
    } else {
      const stats: IStats = {
        date: startDate,
        meetingNum: 0,
        income: 0,
        last5month: [],
        MTM: 0,
        siteVisit: 0,
        daysStats: [],
        newCustomers: 1,
      };
      await statsCollection.add(stats);
    }

    return { success: false, message: "customer counter updated" };
  });
