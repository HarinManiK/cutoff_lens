import { programShortName } from "@/lib/display";

type BranchGroupRule = {
  label: string;
  matches: (programName: string) => boolean;
};

function normalizedProgramName(programName: string) {
  return `${programName} ${programShortName(programName)}`.toLowerCase();
}

function hasAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

export const branchGroups: BranchGroupRule[] = [
  {
    label: "All Computer / AI / Data / Computing",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /computer science/,
        /\bcse\b/,
        /artificial intelligence/,
        /data science/,
        /data analytics/,
        /data engineering/,
        /statistics and data/,
        /mathematics\s*(and|&)\s*computing/,
        /scientific computing/,
        /computational/,
      ]);
    },
  },
  {
    label: "All Electrical / Electronics / Communication / VLSI",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /electrical/,
        /electronics/,
        /communication/,
        /instrumentation/,
        /microelectronics/,
        /\bvlsi\b/,
        /integrated circuit/,
        /\bic design\b/,
        /power\s*(and|&)/,
      ]);
    },
  },
  {
    label: "All Mechanical / Industrial / Manufacturing",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /mechanical/,
        /mechatronics/,
        /manufacturing/,
        /industrial and systems/,
        /industrial engineering/,
        /operations research/,
        /production and industrial/,
      ]);
    },
  },
  {
    label: "All Civil / Architecture / Infrastructure",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /civil/,
        /infrastructure/,
        /^architecture/,
        /geotechnical/,
        /structural/,
      ]);
    },
  },
  {
    label: "All Chemical / Chemistry / Process",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /chemical/,
        /chemistry/,
        /biochemical/,
        /pharmaceutical/,
        /industrial chemistry/,
      ]);
    },
  },
  {
    label: "All Materials / Metallurgy / Ceramic",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /materials?/,
        /metallurgical/,
        /metallurgy/,
        /mineral/,
        /ceramic/,
      ]);
    },
  },
  {
    label: "All Aerospace / Space / Naval / Ocean",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /aerospace/,
        /space science/,
        /naval/,
        /ocean/,
      ]);
    },
  },
  {
    label: "All Bio / Biomedical / Biotechnology",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /bio engineering/,
        /bioengineering/,
        /biological/,
        /^biomedical engineering/,
        /biosciences?/,
        /biotechnology and bioinformatics/,
      ]);
    },
  },
  {
    label: "All Earth / Mining / Petroleum",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /geology/,
        /geological/,
        /geophysics/,
        /geophysical/,
        /earth sciences/,
        /exploration/,
        /mining/,
        /petroleum/,
      ]);
    },
  },
  {
    label: "All Physics / Engineering Science / Pure Science",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /engineering physics/,
        /engineering science/,
        /physical science/,
        /\bphysics\b/,
        /bs in mathematics/,
      ]);
    },
  },
  {
    label: "All Energy / Environment",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /energy engineering/,
        /environmental/,
      ]);
    },
  },
  {
    label: "All Economics / Design / Other Applied",
    matches: (programName) => {
      const name = normalizedProgramName(programName);
      return hasAny(name, [
        /economics/,
        /^design/,
        /engineering design/,
        /agricultural/,
        /agriculture/,
        /food engineering/,
        /textile/,
        /general engineering/,
        /interdisciplinary/,
      ]);
    },
  },
];
