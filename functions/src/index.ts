import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { IOpenHours } from "./interface/IService";
import {
  addMeeting,
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
import { ICustomer } from "./interface/ICustomer";
import { meetingApprovedMessage } from "./Service/whatsAppMessages";

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
    await addMeeting(userId, meeting, _date);

    return { success: true };
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
    let timeSlots: string[] = [];
    if (openHours.isActive) {
      timeSlots = generateTimeSlots(date, serviceDuration, openHours, meetings);
    }

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
      start: "",
      price: 0,
      durationInMinutes: 9999,
      color: 0,
      meetingConfirm: false,
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

exports.websiteData = functions.https.onCall(async (data: any, context) => {
  const Uid: string = data.id;
  try {
    // Get the user document from Firestore
    const userDocRef = await firestore.collection("Users").doc(Uid).get();
    if (!userDocRef.exists) {
      throw new Error("User not found");
    }
    const userData = userDocRef.data();

    // Get the services collection for the user from Firestore
    const userServiceRef = await firestore
      .collection("Users")
      .doc(Uid)
      .collection("Services")
      .get();
    const services = userServiceRef.docs.map((doc) => doc.data());

    // Prepare the data object to be sent in the response
    const data = {
      userDoc: userData,
      services: services,
    };

    return { success: true, data: data };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
});

exports.addWebsiteMeeting = functions.https.onCall(async (data, context) => {
  try {
    const meeting = data.meeting;
    const userId = data.userId;
    const offSetTimeZone: number = data.offSetTimeZone !== null ? data.offSetTimeZone : 0;

    const date = new Date(meeting.start);
    const _date = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    await addMeeting(userId, meeting, _date);

    console.log("meeting was added ");

    const userDocRef = firestore.collection("Users").doc(userId);
    const customersCollection = userDocRef.collection("Customers");
    const querySnapshot = await customersCollection
      .where("phoneNumber", "==", meeting.phoneNumber)
      .limit(1)
      .get();
    if (querySnapshot.empty) {
      const newCustomer: ICustomer = {
        fullName: meeting.customerName,
        phoneNumber: meeting.phoneNumber,
        own: 0,
        lastPractice: "",
      };
      await customersCollection.add(newCustomer);
      const date = new Date();
      date.setMinutes(-offSetTimeZone);

      const notification: INotification = {
        date: date,
        title: "New Customer Was Register",
        customerName: meeting.customerName,
        color: meeting.color,
        addedDate: new Date(Date.now()),
      };
      console.log("Customer was added");
      await addNotification(userId, notification);
    }
    return { success: true, message: "meeting was added!" };
  } catch (error: any) {
    console.error("Error adding meeting:", error.message);
    return { success: false, message: error.message };
  }
});

exports.addWebsiteContactUs = functions.https.onCall(async (data, context) => {
  try {
    const name = data.name;
    const email = data.email;
    const message = data.message;
    const date = new Date();
    const messageData = {
      name: name,
      email: email,
      message: message,
      addDate: date,
    };
    const websiteContactUsRef = firestore.collection("websiteContactU");
    await websiteContactUsRef.add(messageData);

    return { success: true, message: "ContactUs from website was added!" };
  } catch (error: any) {
    console.error("Error adding ContactUs:", error.message);
    return { success: false, message: error.message };
  }
});

exports.siteVisit = functions.https.onCall(async (data: any, context) => {
  const userId = data.id;
  const startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const userDocRef = firestore.collection("Users").doc(userId);
  const statsCollection = userDocRef.collection("Stats");
  const statSnapshot = await statsCollection.where("date", "==", startDate).limit(1).get();

  if (!statSnapshot.empty) {
    const existingStats = statSnapshot.docs[0].data() as IStats;
    const statsId = statSnapshot.docs[0].id;
    await statsCollection.doc(statsId).update({
      siteVisit: existingStats.siteVisit + 1,
    });
  } else {
    const stats: IStats = {
      date: startDate,
      meetingNum: 0,
      income: 0,
      last5month: [],
      MTM: 0,
      siteVisit: 1,
      daysStats: [],
      newCustomers: 0,
    };
    await statsCollection.add(stats);
  }

  return { success: false, message: "siteVisit counter updated" };
});

exports.confirmMeeting = functions.https.onCall(async (data, context) => {
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
    let existingMeetings: IMeeting[] = querySnapshot.docs[0].data().meetings || [];
    const meetingIndex = existingMeetings.findIndex(
      (meet) => new Date(meet.start).getTime() !== date.getTime()
    );
    if (meetingIndex === -1) {
      return { success: false, error: "meeting not found" };
    }
    existingMeetings[meetingIndex].meetingConfirm = true;
    await scheduleDayDoc.update({ meetings: existingMeetings, updatedAt: Date.now() });

    //send approval message
    userDocRef
      .get()
      .then((doc) => {
        if (doc.exists) {
          const userData: any = doc.data();
          //send the message
          meetingApprovedMessage(meeting, userData["address"], userData["businessName"]);
        } else {
          console.log("User document does not exist");
        }
      })
      .catch((error) => {
        console.error("Error getting user document:", error);
      });

    return { success: true, scheduleDayId: scheduleDayDoc.id };
  } catch (error: any) {
    console.error("Error adding meeting:", error.message);
    return { success: false, error: error.message };
  }
});
