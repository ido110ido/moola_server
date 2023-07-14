export interface IStats {
  date: Date;
  meetingNum: number;
  income: number;
  last5month: ILast5month[];
  daysStats: IDayStats[];
  MTM: number;
  siteVisit: number;
  newCustomers: number;
}

export interface IDayStats {
  day: number;
  dayIncome: number;
  meetingNum: number;
}

export interface ILast5month {
  month: Date;
  income: number;
}
