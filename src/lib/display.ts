import type { GenderFilter } from "@/lib/types";

export const JOSAA_FEMALE_GENDER = "Female-only (including Supernumerary)";
export const JOSAA_MALE_GENDER = "Gender-Neutral";

export const seatTypes = [
  "OPEN",
  "OPEN (PwD)",
  "EWS",
  "EWS (PwD)",
  "OBC-NCL",
  "OBC-NCL (PwD)",
  "SC",
  "SC (PwD)",
  "ST",
  "ST (PwD)",
];

export function toJosaaGender(gender: GenderFilter) {
  return gender === "Female" ? JOSAA_FEMALE_GENDER : JOSAA_MALE_GENDER;
}

const labelCollator = new Intl.Collator("en-IN", {
  numeric: true,
  sensitivity: "base",
});

const instituteDisplayOrder = [
  "IIT Bombay",
  "IIT Madras",
  "IIT Delhi",
  "IIT Kanpur",
  "IIT Kharagpur",
  "IIT Roorkee",
  "IIT Guwahati",
  "IIT Hyderabad",
  "IIT (BHU) Varanasi",
  "IIT Indore",
  "IIT (ISM) Dhanbad",
  "IIT Patna",
  "IIT Gandhinagar",
  "IIT Mandi",
  "IIT Jodhpur",
  "IIT Ropar",
  "IIT Bhubaneswar",
  "IIT Jammu",
  "IIT Tirupati",
  "IIT Palakkad",
  "IIT Bhilai",
  "IIT Dharwad",
  "IIT Goa",
];

const instituteDisplayPriority = new Map(
  instituteDisplayOrder.map((institute, index) => [institute, index]),
);

export function shortenInstituteName(name: string) {
  return name
    .replace(/^Indian Institute of Technology,?\s*/i, "IIT ")
    .replace(/^Indian Institution of Technology,?\s*/i, "IIT ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatRank(rank: number | string) {
  const numeric = typeof rank === "number" ? rank : Number(rank);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-IN") : String(rank);
}

export function rankInputLabel(seatType: string) {
  if (seatType === "OPEN") return "CRL rank";
  if (seatType === "OPEN (PwD)") return "CRL-PwD rank";
  if (seatType.includes("(PwD)")) return `${seatType.replace(" (PwD)", "")}-PwD rank`;
  return `${seatType} rank`;
}

function labelAbuDhabiCampus(program: string) {
  return program.replace(/^Abu Dhabi Campus\s*-\s*/i, "IIT Delhi Abu Dhabi Campus - ");
}

export function programShortName(program: string) {
  return labelAbuDhabiCampus(program)
    .replace(/\s*\((4|5) Years?,\s*/i, " (")
    .replace("Bachelor of Technology", "B.Tech")
    .replace("Bachelor and Master of Technology (Dual Degree)", "B.Tech + M.Tech")
    .replace("Bachelor of Technology and MBA (Dual Degree)", "B.Tech + MBA")
    .replace("Bachelor of Science and MBA (Dual Degree)", "B.S. + MBA")
    .replace("Bachelor of Science and Master of Science (Dual Degree)", "B.S. + M.S.")
    .replace("Bachelor of Science", "B.S.")
    .replace("Bachelor of Architecture", "B.Arch")
    .replace("Master of Science", "M.S.");
}

export function compareCutoffByInstituteAndProgram(
  a: { institute: string; program: string; closingRankNumber: number },
  b: { institute: string; program: string; closingRankNumber: number },
) {
  const aInstitute = shortenInstituteName(a.institute);
  const bInstitute = shortenInstituteName(b.institute);
  const aPriority = instituteDisplayPriority.get(aInstitute) ?? Number.MAX_SAFE_INTEGER;
  const bPriority = instituteDisplayPriority.get(bInstitute) ?? Number.MAX_SAFE_INTEGER;

  return (
    aPriority - bPriority ||
    labelCollator.compare(aInstitute, bInstitute) ||
    a.closingRankNumber - b.closingRankNumber ||
    labelCollator.compare(programShortName(a.program), programShortName(b.program))
  );
}

function compactDegree(rawDegree: string) {
  return rawDegree
    .replace("Bachelor and Master of Technology (Dual Degree)", "B.Tech + M.Tech")
    .replace("Bachelor of Technology and MBA (Dual Degree)", "B.Tech + MBA")
    .replace("Bachelor of Science and MBA (Dual Degree)", "B.S. + MBA")
    .replace("Bachelor of Science and Master of Science (Dual Degree)", "B.S. + M.S.")
    .replace("B.Tech. + M.Tech./MS (Dual Degree)", "B.Tech + M.Tech/MS")
    .replace("Integrated Bachelor of Science-Master of Science", "Integrated B.S. + M.S.")
    .replace("Integrated B. Tech. and MBA", "Integrated B.Tech + MBA")
    .replace("Integrated Master of Technology", "Integrated M.Tech")
    .replace("Bachelor of Technology", "B.Tech")
    .replace("Bachelor of Science", "B.S.")
    .replace("Bachelor of Architecture", "B.Arch")
    .trim();
}

export function programMeta(program: string) {
  const details = program.match(/\((\d+)\s+Years?,\s*(.+)\)$/i);
  const duration = details ? `${details[1]} Years` : "Unknown";
  const degree = details ? compactDegree(details[2]) : "Unknown";
  const lowerDegree = degree.toLowerCase();
  const lowerProgram = program.toLowerCase();

  let programType = "Single Degree";
  if (lowerDegree.includes("mba") || lowerProgram.includes(" mba ")) {
    programType = "MBA Dual Degree";
  } else if (lowerDegree.includes("dual degree") || degree.includes("+")) {
    programType = "Dual Degree";
  } else if (lowerDegree.includes("integrated")) {
    programType = "Integrated";
  }

  return {
    degree,
    duration,
    programType,
  };
}
