import type {
  AcademicException,
  AppSettings,
  ClassType,
  DayOfWeek,
  ElectiveGroup,
  Profile,
  Semester,
  Subject,
  Timetable,
  TimetableSlot,
  TimetableVersion,
} from "@/types/domain";

const CREATED_AT = "2026-07-01T00:00:00.000Z";

export const DEMO_IDS = {
  profile: "00000000-0000-4000-8000-000000000001",
  semester: "00000000-0000-4000-8000-000000000002",
  timetable: "00000000-0000-4000-8000-000000000003",
  timetableVersion: "00000000-0000-4000-8000-000000000004",
  electiveOne: "00000000-0000-4000-8000-000000000020",
  electiveTwo: "00000000-0000-4000-8000-000000000021",
  dsp: "00000000-0000-4000-8000-000000000101",
  integratedCircuits: "00000000-0000-4000-8000-000000000102",
  communicationSystems: "00000000-0000-4000-8000-000000000103",
  cmos: "00000000-0000-4000-8000-000000000104",
  microwave: "00000000-0000-4000-8000-000000000105",
  opticalAlternative: "00000000-0000-4000-8000-000000000106",
  professionalEthics: "00000000-0000-4000-8000-000000000107",
  dspLab: "00000000-0000-4000-8000-000000000108",
  miniProject: "00000000-0000-4000-8000-000000000109",
} as const;

export interface DemoSelection {
  selectedBatch: string;
  selectedElectiveSubjectIds: string[];
  trackedClassTypes: Record<ClassType, boolean>;
  includeZeroCredit: boolean;
}

export interface AttendSafeDemoData {
  profile: Profile;
  semester: Semester;
  timetable: Timetable;
  timetableVersion: TimetableVersion;
  subjects: Subject[];
  electiveGroups: ElectiveGroup[];
  timetableSlots: TimetableSlot[];
  academicExceptions: AcademicException[];
  appSettings: AppSettings;
  selection: DemoSelection;
}

function makeSubject(
  id: string,
  code: string,
  name: string,
  shortName: string,
  classType: ClassType,
  credits: number,
  initialHeld: number,
  initialAttended: number,
  isZeroCredit = false,
): Subject {
  return {
    id,
    semesterId: DEMO_IDS.semester,
    code,
    name,
    shortName,
    credits,
    classType,
    isZeroCredit,
    isEnabled: true,
    countsCancelledSessions: false,
    exemptPolicy: "EXCLUDED",
    initialHeld,
    initialAttended,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

interface DemoSlotInput {
  idNumber: number;
  subjectId?: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  faculty?: string[];
  room?: string;
  batchRestriction?: string[];
  electiveGroupId?: string;
  notes?: string;
  isPlaceholder?: boolean;
}

function makeSlot({
  idNumber,
  subjectId,
  dayOfWeek,
  startTime,
  endTime,
  faculty = [],
  room,
  batchRestriction = [],
  electiveGroupId,
  notes,
  isPlaceholder = false,
}: DemoSlotInput): TimetableSlot {
  return {
    id: `00000000-0000-4000-8000-${String(idNumber).padStart(12, "0")}`,
    timetableVersionId: DEMO_IDS.timetableVersion,
    ...(subjectId ? { subjectId } : {}),
    dayOfWeek,
    startTime,
    endTime,
    faculty,
    ...(room ? { room } : {}),
    batchRestriction,
    ...(electiveGroupId ? { electiveGroupId } : {}),
    weekPattern: "EVERY_WEEK",
    ...(notes ? { notes } : {}),
    isEnabled: true,
    isPlaceholder,
    isBreak: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

export function createDemoTimetable(): AttendSafeDemoData {
  const trackedClassTypes: Record<ClassType, boolean> = {
    THEORY: true,
    LAB: false,
    TUTORIAL: false,
    SEMINAR: false,
    PROJECT: false,
    OTHER: false,
  };
  const subjects: Subject[] = [
    makeSubject(
      DEMO_IDS.dsp,
      "BEC501",
      "Digital Signal Processing",
      "DSP",
      "THEORY",
      4,
      20,
      14,
    ),
    makeSubject(
      DEMO_IDS.integratedCircuits,
      "BEC502",
      "Integrated Circuits",
      "IC",
      "THEORY",
      4,
      18,
      13,
    ),
    makeSubject(
      DEMO_IDS.communicationSystems,
      "BEC503",
      "Communication Systems",
      "CS",
      "THEORY",
      4,
      16,
      12,
    ),
    makeSubject(
      DEMO_IDS.cmos,
      "BEC541",
      "CMOS Analog VLSI Design",
      "CMOS",
      "THEORY",
      3,
      15,
      10,
    ),
    makeSubject(
      DEMO_IDS.microwave,
      "BEC542",
      "Microwave Engineering",
      "MWE",
      "THEORY",
      3,
      15,
      11,
    ),
    makeSubject(
      DEMO_IDS.opticalAlternative,
      "BEC543",
      "Optical Communication",
      "OC",
      "THEORY",
      3,
      0,
      0,
    ),
    makeSubject(
      DEMO_IDS.professionalEthics,
      "HSMC501",
      "Professional Ethics",
      "PE",
      "SEMINAR",
      0,
      8,
      7,
      true,
    ),
    makeSubject(
      DEMO_IDS.dspLab,
      "BEC551",
      "Digital Signal Processing Lab",
      "DSP Lab",
      "LAB",
      1,
      6,
      5,
    ),
    makeSubject(
      DEMO_IDS.miniProject,
      "BEC590",
      "Mini Project",
      "Project",
      "PROJECT",
      2,
      0,
      0,
    ),
  ];

  const electiveGroups: ElectiveGroup[] = [
    {
      id: DEMO_IDS.electiveOne,
      semesterId: DEMO_IDS.semester,
      name: "Elective I",
      options: [
        { subjectId: DEMO_IDS.cmos, label: "CMOS Analog VLSI Design" },
        {
          subjectId: DEMO_IDS.opticalAlternative,
          label: "Optical Communication",
        },
      ],
      selectedSubjectIds: [DEMO_IDS.cmos],
      allowMultiple: false,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    {
      id: DEMO_IDS.electiveTwo,
      semesterId: DEMO_IDS.semester,
      name: "Elective II",
      options: [
        { subjectId: DEMO_IDS.microwave, label: "Microwave Engineering" },
      ],
      selectedSubjectIds: [DEMO_IDS.microwave],
      allowMultiple: false,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  ];

  const timetableSlots: TimetableSlot[] = [
    makeSlot({
      idNumber: 201,
      subjectId: DEMO_IDS.dsp,
      dayOfWeek: "MONDAY",
      startTime: "09:00",
      endTime: "10:00",
      faculty: ["AK"],
      room: "AB-301",
    }),
    makeSlot({
      idNumber: 202,
      subjectId: DEMO_IDS.dsp,
      dayOfWeek: "TUESDAY",
      startTime: "11:00",
      endTime: "12:00",
      faculty: ["AK"],
      room: "AB-301",
    }),
    makeSlot({
      idNumber: 203,
      subjectId: DEMO_IDS.dsp,
      dayOfWeek: "THURSDAY",
      startTime: "10:00",
      endTime: "11:00",
      faculty: ["AK"],
      room: "AB-301",
    }),
    makeSlot({
      idNumber: 204,
      subjectId: DEMO_IDS.dsp,
      dayOfWeek: "FRIDAY",
      startTime: "09:00",
      endTime: "10:00",
      faculty: ["AK"],
      room: "AB-301",
    }),
    makeSlot({
      idNumber: 205,
      subjectId: DEMO_IDS.integratedCircuits,
      dayOfWeek: "MONDAY",
      startTime: "10:00",
      endTime: "11:00",
      faculty: ["PJ"],
      room: "AB-304",
    }),
    makeSlot({
      idNumber: 206,
      subjectId: DEMO_IDS.integratedCircuits,
      dayOfWeek: "WEDNESDAY",
      startTime: "09:00",
      endTime: "10:00",
      faculty: ["PJ"],
      room: "AB-304",
    }),
    makeSlot({
      idNumber: 207,
      subjectId: DEMO_IDS.integratedCircuits,
      dayOfWeek: "THURSDAY",
      startTime: "11:00",
      endTime: "12:00",
      faculty: ["PJ"],
      room: "AB-304",
    }),
    makeSlot({
      idNumber: 208,
      subjectId: DEMO_IDS.integratedCircuits,
      dayOfWeek: "FRIDAY",
      startTime: "10:00",
      endTime: "11:00",
      faculty: ["PJ"],
      room: "AB-304",
    }),
    makeSlot({
      idNumber: 209,
      subjectId: DEMO_IDS.communicationSystems,
      dayOfWeek: "TUESDAY",
      startTime: "09:00",
      endTime: "10:00",
      faculty: ["RS"],
      room: "AB-302",
    }),
    makeSlot({
      idNumber: 210,
      subjectId: DEMO_IDS.communicationSystems,
      dayOfWeek: "WEDNESDAY",
      startTime: "10:00",
      endTime: "11:00",
      faculty: ["RS"],
      room: "AB-302",
    }),
    makeSlot({
      idNumber: 211,
      subjectId: DEMO_IDS.communicationSystems,
      dayOfWeek: "THURSDAY",
      startTime: "09:00",
      endTime: "10:00",
      faculty: ["RS"],
      room: "AB-302",
    }),
    makeSlot({
      idNumber: 212,
      subjectId: DEMO_IDS.communicationSystems,
      dayOfWeek: "FRIDAY",
      startTime: "11:00",
      endTime: "12:00",
      faculty: ["RS"],
      room: "AB-302",
    }),
    makeSlot({
      idNumber: 213,
      subjectId: DEMO_IDS.cmos,
      dayOfWeek: "MONDAY",
      startTime: "11:00",
      endTime: "12:00",
      faculty: ["VM"],
      room: "AB-305",
      electiveGroupId: DEMO_IDS.electiveOne,
    }),
    makeSlot({
      idNumber: 214,
      subjectId: DEMO_IDS.cmos,
      dayOfWeek: "TUESDAY",
      startTime: "10:00",
      endTime: "11:00",
      faculty: ["VM"],
      room: "AB-305",
      electiveGroupId: DEMO_IDS.electiveOne,
    }),
    makeSlot({
      idNumber: 215,
      subjectId: DEMO_IDS.cmos,
      dayOfWeek: "WEDNESDAY",
      startTime: "11:00",
      endTime: "12:00",
      faculty: ["VM"],
      room: "AB-305",
      electiveGroupId: DEMO_IDS.electiveOne,
    }),
    makeSlot({
      idNumber: 216,
      subjectId: DEMO_IDS.opticalAlternative,
      dayOfWeek: "MONDAY",
      startTime: "11:00",
      endTime: "12:00",
      faculty: ["NK"],
      room: "AB-306",
      electiveGroupId: DEMO_IDS.electiveOne,
    }),
    makeSlot({
      idNumber: 217,
      subjectId: DEMO_IDS.opticalAlternative,
      dayOfWeek: "TUESDAY",
      startTime: "10:00",
      endTime: "11:00",
      faculty: ["NK"],
      room: "AB-306",
      electiveGroupId: DEMO_IDS.electiveOne,
    }),
    makeSlot({
      idNumber: 218,
      subjectId: DEMO_IDS.opticalAlternative,
      dayOfWeek: "WEDNESDAY",
      startTime: "11:00",
      endTime: "12:00",
      faculty: ["NK"],
      room: "AB-306",
      electiveGroupId: DEMO_IDS.electiveOne,
    }),
    makeSlot({
      idNumber: 219,
      subjectId: DEMO_IDS.microwave,
      dayOfWeek: "MONDAY",
      startTime: "13:00",
      endTime: "14:00",
      faculty: ["SD"],
      room: "AB-307",
      electiveGroupId: DEMO_IDS.electiveTwo,
    }),
    makeSlot({
      idNumber: 220,
      subjectId: DEMO_IDS.microwave,
      dayOfWeek: "TUESDAY",
      startTime: "13:00",
      endTime: "14:00",
      faculty: ["SD"],
      room: "AB-307",
      electiveGroupId: DEMO_IDS.electiveTwo,
    }),
    makeSlot({
      idNumber: 221,
      subjectId: DEMO_IDS.microwave,
      dayOfWeek: "WEDNESDAY",
      startTime: "13:00",
      endTime: "14:00",
      faculty: ["SD"],
      room: "AB-307",
      electiveGroupId: DEMO_IDS.electiveTwo,
    }),
    makeSlot({
      idNumber: 222,
      subjectId: DEMO_IDS.professionalEthics,
      dayOfWeek: "THURSDAY",
      startTime: "13:00",
      endTime: "14:00",
      faculty: ["HM"],
      room: "AB-201",
    }),
    makeSlot({
      idNumber: 223,
      subjectId: DEMO_IDS.dspLab,
      dayOfWeek: "THURSDAY",
      startTime: "14:00",
      endTime: "16:00",
      faculty: ["AK", "MR"],
      room: "DSP Lab",
      batchRestriction: ["A"],
    }),
    makeSlot({
      idNumber: 224,
      subjectId: DEMO_IDS.dspLab,
      dayOfWeek: "FRIDAY",
      startTime: "14:00",
      endTime: "16:00",
      faculty: ["AK", "MR"],
      room: "DSP Lab",
      batchRestriction: ["B"],
    }),
    makeSlot({
      idNumber: 225,
      subjectId: DEMO_IDS.miniProject,
      dayOfWeek: "WEDNESDAY",
      startTime: "14:00",
      endTime: "16:00",
      faculty: [],
      notes:
        "Static project work placeholder; not a scheduled attendance session.",
      isPlaceholder: true,
    }),
  ];

  const profile: Profile = {
    id: DEMO_IDS.profile,
    displayName: "Demo Student",
    institution: "AttendSafe Institute of Technology",
    course: "B.Tech Electronics and Communication",
    section: "ECE-5A",
    batch: "A",
    batches: ["A"],
    timezone: "Asia/Kolkata",
    weekStartsOn: "MONDAY",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  const semester: Semester = {
    id: DEMO_IDS.semester,
    profileId: DEMO_IDS.profile,
    name: "Semester 5 Demo",
    startDate: "2026-07-06",
    endDate: "2026-11-30",
    minimumAttendanceBasisPoints: 6000,
    safetyTargetBasisPoints: 6500,
    teachingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    activeTimetableVersionId: DEMO_IDS.timetableVersion,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  const timetable: Timetable = {
    id: DEMO_IDS.timetable,
    semesterId: DEMO_IDS.semester,
    title: "ECE Semester 5 Demo",
    timezone: "Asia/Kolkata",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  const timetableVersion: TimetableVersion = {
    id: DEMO_IDS.timetableVersion,
    timetableId: DEMO_IDS.timetable,
    semesterId: DEMO_IDS.semester,
    version: 1,
    label: "Demo timetable",
    effectiveStartDate: semester.startDate,
    effectiveEndDate: semester.endDate,
    isConfirmed: true,
    source: "DEMO",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  const academicExceptions: AcademicException[] = [
    {
      id: "00000000-0000-4000-8000-000000000301",
      semesterId: DEMO_IDS.semester,
      type: "HOLIDAY",
      startDate: "2026-08-19",
      endDate: "2026-08-19",
      notes: "Demo institute holiday",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  ];
  const appSettings: AppSettings = {
    id: "app",
    activeProfileId: DEMO_IDS.profile,
    activeSemesterId: DEMO_IDS.semester,
    theme: "SYSTEM",
    selectedBatch: "A",
    selectedBatches: ["A"],
    trackedClassTypes,
    includeZeroCredit: false,
    offlineReady: true,
    notificationsPrepared: false,
    updatedAt: CREATED_AT,
  };

  return {
    profile,
    semester,
    timetable,
    timetableVersion,
    subjects,
    electiveGroups,
    timetableSlots,
    academicExceptions,
    appSettings,
    selection: {
      selectedBatch: "A",
      selectedElectiveSubjectIds: [DEMO_IDS.cmos, DEMO_IDS.microwave],
      trackedClassTypes: { ...trackedClassTypes },
      includeZeroCredit: false,
    },
  };
}

export const createDemoAttendSafeData = createDemoTimetable;
