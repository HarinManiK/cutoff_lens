import { type Fact, notPublished, official, unofficial } from "@/lib/content/provenance";

/**
 * How much the institute itself publishes about placements.
 *
 *   full     consolidated placement report, sometimes broken down by branch
 *   partial  scattered official pages, no consolidated report
 *   none     nothing traceable to a dated, reachable institute source
 */
export type PlacementDisclosure = "full" | "partial" | "none";

export type InstituteProfile = {
  /** Must match the Institute string in the JoSAA data exactly. */
  name: string;
  city: string;
  state: string;
  /** Founding wave. The 2015 institutes have markedly thinner public reporting. */
  cohort: "first" | "second" | "converted" | "third";
  annualReport?: Fact<string>;
  placementPage?: Fact<string>;
  placementDisclosure: PlacementDisclosure;
  /** Branch-level placement, which most institutes do not publish at all. */
  branchPlacement: Fact<string | null>;
  researchFunding?: Fact<string>;
  placementHeadline?: Fact<string>;
};

const PROFILES: InstituteProfile[] = [
  {
    name: "Indian Institute of Technology Madras",
    city: "Chennai",
    state: "Tamil Nadu",
    cohort: "first",
    placementPage: official("https://placement.iitm.ac.in/", "https://placement.iitm.ac.in/"),
    placementDisclosure: "full",
    branchPlacement: official(
      "Placement & Internship Report published annually as a downloadable PDF.",
      "https://internship.iitm.ac.in/downloads/P&I_Report_22-23.pdf",
      "2022-23",
    ),
  },
  {
    name: "Indian Institute of Technology Bombay",
    city: "Mumbai",
    state: "Maharashtra",
    cohort: "first",
    annualReport: official(
      "Annual Report 2024-25",
      "https://www.iitb.ac.in/sites/www.iitb.ac.in/files/2026-01/Annual%20Report%202024-25.pdf",
      "2024-25",
    ),
    placementDisclosure: "partial",
    branchPlacement: notPublished("Institute publishes programme-level medians, not branch-level."),
    placementHeadline: unofficial(
      "Median ₹20 lakh; B.Tech median ₹19.61 lakh; 417 firms participated.",
      "NewsX",
      "https://www.newsx.com/education/iit-bombay-placement-report-2025-placement-rate-declines-to-70-percent-but-average-salary-rises-to-rs-2645-lakh-222564/",
      "2024-25",
    ),
  },
  {
    name: "Indian Institute of Technology Delhi",
    city: "New Delhi",
    state: "Delhi",
    cohort: "first",
    placementPage: official("https://dms.iitd.ac.in/placement-reports/", "https://dms.iitd.ac.in/placement-reports/"),
    placementDisclosure: "partial",
    branchPlacement: notPublished(
      "Only the Department of Management Studies publishes its own reports; no institute-wide branch split.",
    ),
  },
  {
    name: "Indian Institute of Technology Kanpur",
    city: "Kanpur",
    state: "Uttar Pradesh",
    cohort: "first",
    placementPage: official("https://dora.iitk.ac.in/dora/highest-placement", "https://dora.iitk.ac.in/dora/highest-placement"),
    placementDisclosure: "partial",
    branchPlacement: notPublished("Official pages cover highest packages and PhD placement only."),
  },
  {
    name: "Indian Institute of Technology Kharagpur",
    city: "Kharagpur",
    state: "West Bengal",
    cohort: "first",
    placementPage: official("https://cdc.iitkgp.ac.in/", "https://cdc.iitkgp.ac.in/"),
    placementDisclosure: "partial",
    branchPlacement: notPublished("Career Development Centre site does not expose a branch-wise breakdown."),
  },
  {
    name: "Indian Institute of Technology Roorkee",
    city: "Roorkee",
    state: "Uttarakhand",
    cohort: "first",
    annualReport: official(
      "Annual Reports, 2012-13 to 2024-25",
      "https://iitr.ac.in/Institute/Annual_Reports_Of_IIT_Roorkee.html",
      "2024-25",
    ),
    placementDisclosure: "partial",
    branchPlacement: unofficial(
      "Branch placement rates reported as CSE 99.07%, EE 95.80%, ECE 95.79%, ME 89.84%, Civil 65.12%.",
      "Careers360",
      "https://www.careers360.com/university/indian-institute-of-technology-roorkee/placement",
      "2025",
    ),
  },
  {
    name: "Indian Institute of Technology Guwahati",
    city: "Guwahati",
    state: "Assam",
    cohort: "first",
    placementDisclosure: "partial",
    branchPlacement: unofficial(
      "B.Tech 75.65% placed (637 of 842 registered); CSE 90.68% placed.",
      "Careers360",
      "https://www.careers360.com/university/indian-institute-of-technology-guwahati/placement",
      "2025",
    ),
  },
  {
    name: "Indian Institute of Technology (BHU) Varanasi",
    city: "Varanasi",
    state: "Uttar Pradesh",
    cohort: "converted",
    annualReport: official(
      "Annual Report 2024-25",
      "https://www.iitbhu.ac.in/contents/institute/dean/doaa/doc/annual_report_english_2024-25.pdf",
      "2024-25",
    ),
    researchFunding: official(
      "590 ongoing sponsored projects, ₹330.47 crore outlay.",
      "https://www.iitbhu.ac.in/contents/institute/dean/doaa/doc/annual_report_english_2024-25.pdf",
      "2024-25",
    ),
    placementDisclosure: "partial",
    branchPlacement: notPublished("Branch-level outcomes surfaced through an RTI reply rather than publication."),
  },
  {
    name: "Indian Institute of Technology (ISM) Dhanbad",
    city: "Dhanbad",
    state: "Jharkhand",
    cohort: "converted",
    annualReport: official(
      "Annual Report 2023-24",
      "https://www.iitism.ac.in/storage/financial-reports/ARE-67937c8a934a5-2023-2024.pdf",
      "2023-24",
    ),
    placementDisclosure: "partial",
    branchPlacement: notPublished("No branch-wise placement document published."),
  },
  {
    name: "Indian Institute of Technology Hyderabad",
    city: "Hyderabad",
    state: "Telangana",
    cohort: "second",
    placementDisclosure: "partial",
    branchPlacement: unofficial(
      "Phase 1: 304 of 487 B.Tech placed; AI 83.33%, CSE 83.05%, Maths & Computing 77.88%.",
      "Careers360",
      "https://www.careers360.com/university/indian-institute-of-technology-hyderabad/placement",
      "2026",
    ),
  },
  {
    name: "Indian Institute of Technology Gandhinagar",
    city: "Gandhinagar",
    state: "Gujarat",
    cohort: "second",
    annualReport: official("Annual Reports", "https://iitgn.ac.in/about/annualreports"),
    placementPage: official("https://cds.iitgn.ac.in/about-us/", "https://cds.iitgn.ac.in/about-us/"),
    placementDisclosure: "partial",
    branchPlacement: notPublished("2025 placement report not yet released at the time of checking."),
  },
  {
    name: "Indian Institute of Technology Patna",
    city: "Patna",
    state: "Bihar",
    cohort: "second",
    placementPage: official("https://ccdc.iitp.ac.in/branch-wise-brochure.php", "https://ccdc.iitp.ac.in/branch-wise-brochure.php"),
    placementDisclosure: "full",
    branchPlacement: official(
      "Branch-wise brochures published by the Centre for Career Development and Counselling.",
      "https://ccdc.iitp.ac.in/branch-wise-brochure.php",
    ),
  },
  {
    name: "Indian Institute of Technology Ropar",
    city: "Rupnagar",
    state: "Punjab",
    cohort: "second",
    placementDisclosure: "partial",
    branchPlacement: unofficial(
      "321 B.Tech participated, 257 full-time offers plus 85 PPOs; median ₹18 lakh, average ₹23.07 lakh.",
      "Shiksha",
      "https://www.shiksha.com/college/iit-ropar-indian-institute-of-technology-32693/placement",
      "2025",
    ),
  },
  {
    name: "Indian Institute of Technology Bhubaneswar",
    city: "Bhubaneswar",
    state: "Odisha",
    cohort: "second",
    annualReport: official("Fee structure and academics", "https://www.iitbbs.ac.in/index.php/home/academics/fee-structure/"),
    placementDisclosure: "partial",
    branchPlacement: notPublished("No branch-wise placement document published."),
  },
  {
    name: "Indian Institute of Technology Jodhpur",
    city: "Jodhpur",
    state: "Rajasthan",
    cohort: "second",
    placementDisclosure: "partial",
    branchPlacement: unofficial(
      "336 B.Tech placed, 92% placement rate; overall average above ₹19 lakh.",
      "Shiksha",
      "https://www.shiksha.com/college/iit-jodhpur-indian-institute-of-technology-32712/placement",
      "2026",
    ),
  },
  {
    name: "Indian Institute of Technology Indore",
    city: "Indore",
    state: "Madhya Pradesh",
    cohort: "second",
    placementDisclosure: "partial",
    branchPlacement: notPublished("No branch-wise placement document published."),
  },
  {
    name: "Indian Institute of Technology Mandi",
    city: "Mandi",
    state: "Himachal Pradesh",
    cohort: "second",
    placementDisclosure: "partial",
    branchPlacement: unofficial(
      "72.39% of the B.Tech class placed by 192 recruiters; CSE average ₹26.55 lakh, overall median ₹18.5 lakh.",
      "Shiksha",
      "https://www.shiksha.com/college/iit-mandi-indian-institute-of-technology-33322/placement",
      "2024",
    ),
  },
  {
    name: "Indian Institute of Technology Goa",
    city: "Ponda",
    state: "Goa",
    cohort: "third",
    placementPage: official("https://iitgoa.ac.in/~placement/Placements.html", "https://iitgoa.ac.in/~placement/Placements.html"),
    placementDisclosure: "full",
    branchPlacement: official(
      "Branch-wise enrolled, registered and placed counts for CSE, EE, ME and MnC. Salary figures are not published.",
      "https://iitgoa.ac.in/~placement/Placements.html",
      "2025-26",
    ),
    placementHeadline: official(
      "B.Tech 92.24% placed, M.Tech 83.33%, combined 91.41%. 135+ recruiters.",
      "https://iitgoa.ac.in/~placement/Placements.html",
      "2025-26",
    ),
  },
  {
    name: "Indian Institute of Technology Tirupati",
    city: "Tirupati",
    state: "Andhra Pradesh",
    cohort: "third",
    annualReport: official(
      "Annual Report 2024-25",
      "https://files.iittp.ac.in/pdfs/annualreport/Hindi_Annual_Report_2024_25.pdf",
      "2024-25",
    ),
    placementDisclosure: "none",
    branchPlacement: notPublished(
      "Institute confirmed via RTI that it holds no information on average and median salaries.",
    ),
  },
  {
    name: "Indian Institute of Technology Dharwad",
    city: "Dharwad",
    state: "Karnataka",
    cohort: "third",
    annualReport: official(
      "Annual Report 2024-25",
      "https://www.iitdh.ac.in/sites/default/files/2025-12/Annual%20Report%202024-25%20(With%20cover%20pages)_compressed.pdf",
      "2024-25",
    ),
    placementDisclosure: "none",
    branchPlacement: notPublished("No placement figures traceable to a dated institute source."),
  },
  {
    name: "Indian Institute of Technology Palakkad",
    city: "Palakkad",
    state: "Kerala",
    cohort: "third",
    placementDisclosure: "none",
    branchPlacement: notPublished("No placement figures traceable to a dated institute source."),
  },
  {
    name: "Indian Institute of Technology Jammu",
    city: "Jammu",
    state: "Jammu and Kashmir",
    cohort: "third",
    placementDisclosure: "none",
    branchPlacement: notPublished("No placement figures traceable to a dated institute source."),
  },
  {
    name: "Indian Institute of Technology Bhilai",
    city: "Raipur",
    state: "Chhattisgarh",
    cohort: "third",
    placementDisclosure: "none",
    branchPlacement: notPublished("No placement figures traceable to a dated institute source."),
  },
];

const byName = new Map(PROFILES.map((profile) => [profile.name, profile]));

export function instituteProfile(name: string) {
  return byName.get(name.trim()) ?? null;
}

export const cohortLabel: Record<InstituteProfile["cohort"], string> = {
  first: "Founding IIT",
  second: "Established 2008-09",
  converted: "Converted to IIT",
  third: "Established 2015-16",
};

export const disclosureLabel: Record<PlacementDisclosure, string> = {
  full: "Publishes placement reports",
  partial: "Publishes some placement data",
  none: "Publishes no placement data",
};
