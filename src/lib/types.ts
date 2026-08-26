export type GenderFilter = "Male" | "Female";

export type Dataset = {
  year: number;
  round: number;
};

export type DatasetsResponse = {
  datasets: Dataset[];
  meta: {
    source: "supabase" | "local-csv";
  };
};

export type CutoffResult = {
  id: string;
  year: number;
  round: number;
  institute: string;
  program: string;
  quota: string;
  seatType: string;
  gender: string;
  openingRankRaw: string;
  closingRankRaw: string;
  openingRankNumber: number;
  closingRankNumber: number;
  isPreparatory: boolean;
};

export type CutoffsResponse = {
  rows: CutoffResult[];
  meta: {
    source: "supabase" | "local-csv";
    year: number;
    round: number;
    seatType: string;
    gender: GenderFilter;
    rank: number | null;
    total: number;
  };
};

export type ColumnKey =
  | "institute"
  | "program"
  | "closingRank"
  | "openingRank"
  | "seatType"
  | "gender"
  | "round"
  | "year"
  | "quota"
  | "rankMargin"
  | "degree"
  | "duration"
  | "programType";
