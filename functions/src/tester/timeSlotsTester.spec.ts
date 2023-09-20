import { generateTimeSlots } from "../Service/service";
import { IMeeting } from "../interface/IMeeting";
import { IOpenHours } from "../interface/IService";

describe("generateTimeSlots", () => {
  it("should return empty array if date is before today", () => {
    const date = new Date(); // Replace with an appropriate date
    date.setDate(date.getDate() - 1);
    const openHours: IOpenHours = {
      startTime: "09:00",
      endTime: "17:00",
      dayOfWeek: "",
      isActive: true,
    }; // Example open hours
    const meetings: IMeeting[] = []; // No meetings
    const serviceDuration = 30; // Example service duration in minutes

    const result = generateTimeSlots(date, serviceDuration, openHours, meetings);

    expect(result).toEqual([]);
  });

  it("should generate time slots starting from the current time", () => {
    const date = new Date(); // Current date and time
    const openHours: IOpenHours = {
      startTime: "09:00",
      endTime: "17:00",
      dayOfWeek: "",
      isActive: true,
    }; // Example open hours
    const closeTime = date;
    closeTime.setHours(17, 0);
    const meetings: IMeeting[] = []; // No meetings
    const serviceDuration = 30; // Example service duration in minutes

    const result = generateTimeSlots(date, serviceDuration, openHours, meetings);
    const slots: string[] = [];
    while (date < closeTime) {
      let minutes: string = date.getMinutes().toString();
      if (date.getMinutes() === 0) {
        minutes = "00";
      }
      const formattedTime: string = date.getHours() + ":" + minutes;
      slots.push(formattedTime);
      date.setMinutes(date.getMinutes() + serviceDuration);
    }
    console.log("slots: " + slots);

    expect(result).toEqual(slots);
  });
  it("should return empty array if closing time passed today", () => {
    const date = new Date(); // Replace with an appropriate date
    date.setHours(18, 12);
    const openHours: IOpenHours = {
      startTime: "09:00",
      endTime: "17:00",
      dayOfWeek: "",
      isActive: true,
    }; // Example open hours
    const meetings: IMeeting[] = []; // No meetings
    const serviceDuration = 30; // Example service duration in minutes

    const result = generateTimeSlots(date, serviceDuration, openHours, meetings);

    expect(result).toEqual([]);
  });

  // Add more test cases for other scenarios and edge cases
});
