import axios, { AxiosResponse } from "axios";
import { IMeeting } from "../interface/IMeeting";

function formatDateToHebrewString(date: Date): string {
  const timeZone: string = "Asia/Jerusalem"; // Israel Standard Time (IST) or Israel Daylight Time (IDT)

  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  };

  const formatter = new Intl.DateTimeFormat("he-IL", options);
  return formatter.format(date);
}
function getTime(date: Date): string {
  const timeZone: string = "Asia/Jerusalem"; // Israel Standard Time (IST) or Israel Daylight Time (IDT)

  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "numeric",
    timeZone,
  };

  const formatter = new Intl.DateTimeFormat("he-IL", options);
  return formatter.format(date);
}
const openGoogleMaps = (address: string): string => {
  const encodedAddress = encodeURIComponent(address);
  const googleMapsUrl = `/?api=1&query=${encodedAddress}`;
  return googleMapsUrl;
};

async function sendFacebookMessage(payload: any): Promise<any> {
  try {
    // Define the API endpoint and request headers
    const apiEndpoint: string = "https://graph.facebook.com/v17.0/143876278799241/messages";
    const accessToken: string =
      "EAADUvy815tcBO8yKAsgzoeUz6jq43ALmx6eCPlF5iPdlDoMxSGjy1isUrZC8Q266XrLsghNqr9PJ5ZAHL0mSByJuThCD1u8UtQzLIeFffR9BJcRpgcCvOt8jaOinwjbIHwtEByeqjCW1SI84ziqOEilsHozVwIU9aZAz7jwm6Rho0tAxJJbauEcbxpZCYg28"; // Replace with your Facebook access token
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
    // Make the API POST request
    const response: AxiosResponse<any> = await axios.post(apiEndpoint, payload, { headers });

    // Handle the response (you can log or process it further as needed)
    console.log("API Response:", response.status, response.data);
    return response.data;
  } catch (error: any) {
    console.error("API Error:", error.message);
    throw error;
  }
}

export const meetingApprovedMessage = (
  meeting: IMeeting,
  address: string,
  businessName: string
) => {
  const startDate = new Date(meeting.start);
  // Construct the request payload
  const payload = {
    messaging_product: "whatsapp",
    to: meeting.phoneNumber,
    type: "template",
    template: {
      name: "meeting_approved",
      language: {
        code: "he",
      },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: meeting.customerName,
            },
            {
              type: "text",
              text: businessName,
            },
            {
              type: "text",
              text: formatDateToHebrewString(startDate),
            },
            {
              type: "text",
              text: getTime(startDate),
            },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [
            {
              type: "text",
              text: openGoogleMaps(address),
            },
          ],
        },
      ],
    },
  };

  // Example usage with a phone number
  sendFacebookMessage(payload)
    .then((response) => {
      // Handle the response or perform additional actions
    })
    .catch((error) => {
      // Handle errors
    });
  //whatsAppMessages
};
