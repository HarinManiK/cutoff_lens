"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  compareCutoffByInstituteAndProgram,
  formatRank,
  programMeta,
  programShortName,
  seatTypes,
  shortenInstituteName,
} from "@/lib/display";
import { cutoffMatchesSearch, programMatchesSearch } from "@/lib/search";
import { LogoMark } from "@/components/LogoMark";
import { branchGroups } from "@/lib/branch-groups";
import type {
  ColumnKey,
  CutoffResult,
  CutoffsResponse,
  Dataset,
  DatasetsResponse,
  GenderFilter,
} from "@/lib/types";

type MultiFilterKey = "institute" | "program" | "degree" | "duration" | "programType";
type PanelMultiFilter = "institute" | "program" | "degree" | "programType";
type QuickSelectGroup = {
  label: string;
  values: string[];
};

const DEFAULT_YEAR = 2026;
const DEFAULT_ROUND = 5;

const defaultColumns: ColumnKey[] = [
  "institute",
  "program",
  "openingRank",
  "closingRank",
];

const columnLabels: Record<ColumnKey, string> = {
  institute: "IIT",
  program: "Branch",
  closingRank: "Closing Rank",
  openingRank: "Opening Rank",
  seatType: "Seat Type",
  gender: "Gender",
  round: "Round",
  year: "Year",
  quota: "Quota",
  rankMargin: "Rank Margin",
  degree: "Degree",
  duration: "Course Duration",
  programType: "Course Type",
};

const configurableColumns: ColumnKey[] = [
  "institute",
  "program",
  "openingRank",
  "closingRank",
  "degree",
  "duration",
  "programType",
];

function normalizeColumnOrder(columns: ColumnKey[]) {
  return configurableColumns.filter((column) => columns.includes(column));
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function hasSameItems(a: string[], b: string[]) {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function multiSelectSummary(values: string[], renderOption: (option: string) => string) {
  if (values.length === 0) return "All";
  if (values.length === 1) return renderOption(values[0]);
  return `${values.length} selected`;
}

function LabeledChoice({
  label,
  value,
  options,
  onChange,
  onOpen,
  renderOption = (option) => option,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onOpen?: () => void;
  renderOption?: (option: string) => string;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select
        className="filter-select"
        value={value}
        onFocus={onOpen}
        onPointerDown={onOpen}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {renderOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
  onOpen,
  renderOption = (option) => option,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onOpen?: () => void;
  renderOption?: (option: string) => string;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select
        className="filter-select"
        value={value}
        onFocus={onOpen}
        onPointerDown={onOpen}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {renderOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function MultiSelectTrigger({
  label,
  isOpen,
  selectedValues,
  onToggle,
  children,
  renderOption = (option) => option,
}: {
  label: string;
  isOpen: boolean;
  selectedValues: string[];
  onToggle: () => void;
  children?: ReactNode;
  renderOption?: (option: string) => string;
}) {
  const title = selectedValues.length > 0 ? selectedValues.map(renderOption).join(", ") : "All";

  return (
    <div className="filter-field filter-field--multi">
      <span>{label}</span>
      <button
        aria-expanded={isOpen}
        className={isOpen ? "multi-select-trigger is-active" : "multi-select-trigger"}
        title={title}
        type="button"
        onClick={onToggle}
      >
        <span>{multiSelectSummary(selectedValues, renderOption)}</span>
        <ChevronDown size={15} />
      </button>
      {children}
    </div>
  );
}

function MultiSelectPanel({
  title,
  options,
  selectedValues,
  searchValue,
  onSearchChange,
  onChange,
  onSave,
  onClose,
  align = "left",
  renderOption = (option) => option,
  matchesSearch,
  quickSelectGroups = [],
  listLayout = false,
}: {
  title: string;
  options: string[];
  selectedValues: string[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onChange: (values: string[]) => void;
  onSave: () => void;
  onClose: () => void;
  align?: "left" | "right";
  renderOption?: (option: string) => string;
  matchesSearch?: (option: string, query: string) => boolean;
  quickSelectGroups?: QuickSelectGroup[];
  listLayout?: boolean;
}) {
  const query = searchValue.trim().toLowerCase();
  const visibleOptions = query
    ? options.filter((option) => {
      if (matchesSearch) {
        return matchesSearch(option, searchValue);
      }

      return renderOption(option).toLowerCase().includes(query);
    })
    : options;

  function toggle(option: string) {
    if (selectedValues.includes(option)) {
      onChange(selectedValues.filter((value) => value !== option));
      return;
    }

    onChange([...selectedValues, option]);
  }

  function toggleGroup(groupValues: string[]) {
    const valuesInGroup = new Set(groupValues);
    const hasWholeGroup = groupValues.every((value) => selectedValues.includes(value));

    if (hasWholeGroup) {
      onChange(selectedValues.filter((value) => !valuesInGroup.has(value)));
      return;
    }

    const nextValues = new Set([...selectedValues, ...groupValues]);
    onChange(options.filter((option) => nextValues.has(option)));
  }

  const panelClassName = [
    "multi-filter-panel",
    align === "right" ? "multi-filter-panel--right" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={panelClassName}>
      <div className="multi-filter-panel__head">
        <div>
          <b>{title}</b>
          <span>
            {selectedValues.length === 0
              ? "All options"
              : `${selectedValues.length.toLocaleString("en-IN")} selected`}
          </span>
        </div>
        <button className="multi-filter-close" type="button" aria-label={`Close ${title} filter`} onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <label className="multi-filter-search">
        <Search size={15} />
        <input
          placeholder={`Search ${title.toLowerCase()}`}
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      {visibleOptions.length > 0 || quickSelectGroups.length > 0 ? (
        <div className={listLayout ? "multi-option-list multi-option-list--list" : "multi-option-list"}>
          {quickSelectGroups.length > 0
            ? quickSelectGroups.map((group) => {
                const isWholeGroupSelected = group.values.every((value) => selectedValues.includes(value));

                return (
                  <label className="multi-option" key={group.label}>
                    <input
                      checked={isWholeGroupSelected}
                      type="checkbox"
                      onChange={() => toggleGroup(group.values)}
                    />
                    <span>{group.label}</span>
                  </label>
                );
              })
            : null}

          {visibleOptions.map((option) => (
            <label className="multi-option" key={option}>
              <input
                checked={selectedValues.includes(option)}
                type="checkbox"
                onChange={() => toggle(option)}
              />
              <span>{renderOption(option)}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="multi-empty">No matching options</div>
      )}

      <div className="multi-filter-actions">
        <button
          className="multi-filter-action"
          type="button"
          onClick={() => {
            onChange([]);
            onSave();
          }}
        >
          Reset
        </button>
        <button className="multi-filter-action multi-filter-action--primary" type="button" onClick={onSave}>
          Save
        </button>
      </div>
    </div>
  );
}

function ColumnToggles({
  visibleColumns,
  onChange,
}: {
  visibleColumns: ColumnKey[];
  onChange: (columns: ColumnKey[]) => void;
}) {
  function toggle(column: ColumnKey) {
    if (visibleColumns.includes(column)) {
      if (visibleColumns.length === 1) return;
      onChange(normalizeColumnOrder(visibleColumns.filter((value) => value !== column)));
      return;
    }

    onChange(normalizeColumnOrder([...visibleColumns, column]));
  }

  return (
    <div className="filter-field filter-field--columns">
      <span>Columns</span>
      <div className="column-toggle-row">
        {configurableColumns.map((column) => (
          <button
            className={visibleColumns.includes(column) ? "column-toggle is-active" : "column-toggle"}
            key={column}
            type="button"
            onClick={() => toggle(column)}
          >
            {columnLabels[column]}
          </button>
        ))}
      </div>
    </div>
  );
}

function renderCell(row: CutoffResult, column: ColumnKey, rankNumber: number | null) {
  switch (column) {
    case "institute":
      return shortenInstituteName(row.institute);
    case "program":
      return programShortName(row.program);
    case "closingRank":
      return <span className="rank-badge">{formatRank(row.closingRankRaw)}</span>;
    case "openingRank":
      return formatRank(row.openingRankRaw);
    case "seatType":
      return row.seatType;
    case "gender":
      return row.gender === "Gender-Neutral" ? "Gender Neutral" : "Female";
    case "round":
      return `Round ${row.round}`;
    case "year":
      return row.year;
    case "quota":
      return row.quota;
    case "rankMargin":
      return rankNumber ? `+${formatRank(row.closingRankNumber - rankNumber)}` : "-";
    case "degree":
      return programMeta(row.program).degree;
    case "duration":
      return programMeta(row.program).duration;
    case "programType":
      return programMeta(row.program).programType;
    default:
      return null;
  }
}

export function JeeAdvancedExplorer() {
  const [datasets, setDatasets] = useState<Dataset[]>([
    { year: DEFAULT_YEAR, round: DEFAULT_ROUND },
  ]);
  const [year, setYear] = useState(String(DEFAULT_YEAR));
  const [round, setRound] = useState(String(DEFAULT_ROUND));
  const [seatType, setSeatType] = useState("OPEN");
  const [gender, setGender] = useState<GenderFilter>("Male");
  const [rank, setRank] = useState("");
  const [rows, setRows] = useState<CutoffResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedInstitutes, setSelectedInstitutes] = useState<string[]>([]);
  const [selectedPrograms, setSelectedPrograms] = useState<string[]>([]);
  const [selectedDegrees, setSelectedDegrees] = useState<string[]>([]);
  const [selectedDurations, setSelectedDurations] = useState<string[]>([]);
  const [selectedProgramTypes, setSelectedProgramTypes] = useState<string[]>([]);
  const [tableSearch, setTableSearch] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(defaultColumns);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [openMultiFilter, setOpenMultiFilter] = useState<PanelMultiFilter | null>(null);
  const [instituteSearch, setInstituteSearch] = useState("");
  const [programSearch, setProgramSearch] = useState("");
  const [degreeSearch, setDegreeSearch] = useState("");
  const [programTypeSearch, setProgramTypeSearch] = useState("");
  const [showFilterJump, setShowFilterJump] = useState(false);

  const closeOpenPanels = useCallback(() => {
    setOpenMultiFilter(null);
  }, []);

  const yearOptions = useMemo(() => {
    return [...new Set(datasets.map((dataset) => dataset.year))].sort((a, b) => b - a).map(String);
  }, [datasets]);

  const roundOptions = useMemo(() => {
    return datasets
      .filter((dataset) => String(dataset.year) === year)
      .map((dataset) => dataset.round)
      .sort((a, b) => a - b)
      .map(String);
  }, [datasets, year]);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/cutoffs/jee-advanced/datasets", { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<DatasetsResponse>) : null))
      .then((data) => {
        if (data?.datasets?.length) setDatasets(data.datasets);
      })
      .catch(() => {
        // Keep the default dataset when discovery fails; the cutoffs request reports the real error.
      });

    return () => controller.abort();
  }, []);

  // Keep the selected year/round on a dataset that actually exists.
  useEffect(() => {
    if (yearOptions.length > 0 && !yearOptions.includes(year)) {
      setYear(yearOptions[0]);
      return;
    }

    if (roundOptions.length > 0 && !roundOptions.includes(round)) {
      setRound(roundOptions[roundOptions.length - 1]);
    }
  }, [round, roundOptions, year, yearOptions]);

  const rankNumber = useMemo(() => {
    const trimmedRank = rank.trim();
    if (!trimmedRank) return 1;

    const parsed = Number(trimmedRank);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [rank]);

  const enteredRankNumber = rank.trim() ? rankNumber : null;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      year,
      round,
      seatType,
      gender,
    });

    if (rankNumber) params.set("rank", String(rankNumber));

    setLoading(true);
    setError(null);

    fetch(`/api/cutoffs/jee-advanced?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Unable to load cutoffs.");
        }
        return response.json() as Promise<CutoffsResponse>;
      })
      .then((data) => {
        setRows(data.rows);
      })
      .catch((nextError: Error) => {
        if (nextError.name !== "AbortError") {
          setError(nextError.message);
          setRows([]);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [gender, rankNumber, round, seatType, year]);

  function clearSecondaryFilters() {
    setSelectedInstitutes([]);
    setSelectedPrograms([]);
    setSelectedDegrees([]);
    setSelectedDurations([]);
    setSelectedProgramTypes([]);
    setTableSearch("");
    setInstituteSearch("");
    setProgramSearch("");
    setDegreeSearch("");
    setProgramTypeSearch("");
    setOpenMultiFilter(null);
  }

  const rowMatchesSelections = useCallback((row: CutoffResult, ignore?: MultiFilterKey) => {
    const meta = programMeta(row.program);

    if (ignore !== "institute" && selectedInstitutes.length > 0 && !selectedInstitutes.includes(row.institute)) {
      return false;
    }
    if (ignore !== "program" && selectedPrograms.length > 0 && !selectedPrograms.includes(row.program)) {
      return false;
    }
    if (ignore !== "degree" && selectedDegrees.length > 0 && !selectedDegrees.includes(meta.degree)) {
      return false;
    }
    if (ignore !== "duration" && selectedDurations.length > 0 && !selectedDurations.includes(meta.duration)) {
      return false;
    }
    if (
      ignore !== "programType" &&
      selectedProgramTypes.length > 0 &&
      !selectedProgramTypes.includes(meta.programType)
    ) {
      return false;
    }

    return true;
  }, [
    selectedDegrees,
    selectedDurations,
    selectedInstitutes,
    selectedProgramTypes,
    selectedPrograms,
  ]);

  const rowsForOptions = useCallback((ignore: MultiFilterKey) => {
    return rows.filter((row) => rowMatchesSelections(row, ignore));
  }, [rowMatchesSelections, rows]);

  const instituteOptions = useMemo(() => {
    return uniqueSorted(rowsForOptions("institute").map((row) => row.institute));
  }, [rowsForOptions]);

  const programOptions = useMemo(() => {
    return uniqueSorted(rowsForOptions("program").map((row) => row.program));
  }, [rowsForOptions]);

  const programQuickSelectGroups = useMemo(() => {
    return branchGroups
      .map((group) => ({
        label: group.label,
        values: programOptions.filter((program) => group.matches(program)),
      }))
      .filter((group) => group.values.length > 0);
  }, [programOptions]);

  const degreeOptions = useMemo(() => {
    return uniqueSorted(rowsForOptions("degree").map((row) => programMeta(row.program).degree));
  }, [rowsForOptions]);

  const durationOptions = useMemo(() => {
    return uniqueSorted(rowsForOptions("duration").map((row) => programMeta(row.program).duration));
  }, [rowsForOptions]);

  const programTypeOptions = useMemo(() => {
    return uniqueSorted(rowsForOptions("programType").map((row) => programMeta(row.program).programType));
  }, [rowsForOptions]);

  useEffect(() => {
    const nextInstitutes = selectedInstitutes.filter((institute) => instituteOptions.includes(institute));
    if (!hasSameItems(nextInstitutes, selectedInstitutes)) {
      setSelectedInstitutes(nextInstitutes);
    }
  }, [instituteOptions, selectedInstitutes]);

  useEffect(() => {
    const nextPrograms = selectedPrograms.filter((program) => programOptions.includes(program));
    if (!hasSameItems(nextPrograms, selectedPrograms)) {
      setSelectedPrograms(nextPrograms);
    }
  }, [programOptions, selectedPrograms]);

  useEffect(() => {
    const nextDegrees = selectedDegrees.filter((degree) => degreeOptions.includes(degree));
    if (!hasSameItems(nextDegrees, selectedDegrees)) {
      setSelectedDegrees(nextDegrees);
    }
  }, [degreeOptions, selectedDegrees]);

  useEffect(() => {
    const nextDurations = selectedDurations.filter((duration) => durationOptions.includes(duration));
    if (!hasSameItems(nextDurations, selectedDurations)) {
      setSelectedDurations(nextDurations);
    }
  }, [durationOptions, selectedDurations]);

  useEffect(() => {
    const nextProgramTypes = selectedProgramTypes.filter((type) => programTypeOptions.includes(type));
    if (!hasSameItems(nextProgramTypes, selectedProgramTypes)) {
      setSelectedProgramTypes(nextProgramTypes);
    }
  }, [programTypeOptions, selectedProgramTypes]);

  useEffect(() => {
    function updateFilterJumpVisibility() {
      const filterBar = document.getElementById("jee-advanced-filters");
      const isMobile = window.matchMedia("(max-width: 860px)").matches;

      if (!filterBar || !isMobile) {
        setShowFilterJump(false);
        return;
      }

      setShowFilterJump(filterBar.getBoundingClientRect().bottom < 8);
    }

    updateFilterJumpVisibility();
    window.addEventListener("scroll", updateFilterJumpVisibility, { passive: true });
    window.addEventListener("resize", updateFilterJumpVisibility);

    return () => {
      window.removeEventListener("scroll", updateFilterJumpVisibility);
      window.removeEventListener("resize", updateFilterJumpVisibility);
    };
  }, []);

  const filteredRows = useMemo(() => {
    const nextRows = rows
      .filter((row) => rowMatchesSelections(row))
      .filter((row) => cutoffMatchesSearch(row, tableSearch));

    return nextRows.sort(compareCutoffByInstituteAndProgram);
  }, [
    rows,
    tableSearch,
    rowMatchesSelections,
  ]);

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <Link className="filter-chip" href="/">
            <ArrowLeft size={15} />
            Exams
          </Link>
          <div className="page-title-row">
            <LogoMark className="logo-mark--page" />
            <h1 className="page-title">JEE Advanced</h1>
          </div>
          <p className="page-kicker">based on {year} official data (Round {round})</p>
        </div>
      </header>

      <section
        className="filter-bar"
        id="jee-advanced-filters"
        aria-label="Filters"
      >
        <div className="filter-strip">
          <div className="filter-field filter-field--range">
            <span>Rank</span>
            <input
              className="filter-input filter-input--rank"
              inputMode="numeric"
              min="1"
              placeholder="Enter rank"
              type="number"
              value={rank}
              onChange={(event) => setRank(event.target.value)}
            />
          </div>

          <label className="filter-field filter-field--category">
            <span>Category</span>
            <select
              className="filter-select"
              value={seatType}
              onFocus={closeOpenPanels}
              onPointerDown={closeOpenPanels}
              onChange={(event) => {
                setSeatType(event.target.value);
                clearSecondaryFilters();
              }}
            >
              {seatTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-field filter-field--gender">
            <span>Gender</span>
            <select
              className="filter-select"
              value={gender}
              onFocus={closeOpenPanels}
              onPointerDown={closeOpenPanels}
              onChange={(event) => {
                setGender(event.target.value as GenderFilter);
                clearSecondaryFilters();
              }}
            >
              <option value="Male">Gender Neutral</option>
              <option value="Female">Female</option>
            </select>
          </label>

          <button
            className={showMoreFilters ? "filter-chip is-active" : "filter-chip"}
            type="button"
            aria-expanded={showMoreFilters}
            onClick={() => {
              setOpenMultiFilter(null);
              setShowMoreFilters((value) => !value);
            }}
          >
            <SlidersHorizontal size={15} />
            More filters
          </button>

          <button
            className="filter-chip"
            type="button"
            onClick={() => {
              setRank("");
              setSeatType("OPEN");
              setGender("Male");
              setYear(String(DEFAULT_YEAR));
              setRound(String(DEFAULT_ROUND));
              clearSecondaryFilters();
              setShowMoreFilters(false);
            }}
          >
            Reset
          </button>
        </div>

        {showMoreFilters ? (
          <div className="more-filters-panel">
            <div className="more-filters-row more-filters-row--pair">
              <MultiSelectTrigger
                label="Institution"
                renderOption={shortenInstituteName}
                isOpen={openMultiFilter === "institute"}
                selectedValues={selectedInstitutes}
                onToggle={() => {
                  setOpenMultiFilter((value) => (value === "institute" ? null : "institute"));
                }}
              >
                {openMultiFilter === "institute" ? (
                  <MultiSelectPanel
                    title="Institution"
                    options={instituteOptions}
                    renderOption={shortenInstituteName}
                    searchValue={instituteSearch}
                    selectedValues={selectedInstitutes}
                    onChange={setSelectedInstitutes}
                    onClose={() => setOpenMultiFilter(null)}
                    onSave={() => setOpenMultiFilter(null)}
                    onSearchChange={setInstituteSearch}
                  />
                ) : null}
              </MultiSelectTrigger>

              <MultiSelectTrigger
                label="Branch"
                renderOption={programShortName}
                isOpen={openMultiFilter === "program"}
                selectedValues={selectedPrograms}
                onToggle={() => {
                  setOpenMultiFilter((value) => (value === "program" ? null : "program"));
                }}
              >
                {openMultiFilter === "program" ? (
                  <MultiSelectPanel
                    title="Branch"
                    options={programOptions}
                    matchesSearch={programMatchesSearch}
                    renderOption={programShortName}
                    quickSelectGroups={programQuickSelectGroups}
                    listLayout
                    align="right"
                    searchValue={programSearch}
                    selectedValues={selectedPrograms}
                    onChange={setSelectedPrograms}
                    onClose={() => setOpenMultiFilter(null)}
                    onSave={() => setOpenMultiFilter(null)}
                    onSearchChange={setProgramSearch}
                  />
                ) : null}
              </MultiSelectTrigger>
            </div>

            <div className="more-filters-row more-filters-row--pair">
              <LabeledChoice
                label="Year"
                options={yearOptions}
                value={year}
                onOpen={closeOpenPanels}
                onChange={setYear}
              />

              <LabeledChoice
                label="Round"
                options={roundOptions}
                value={round}
                renderOption={(option) => `Round ${option}`}
                onOpen={closeOpenPanels}
                onChange={setRound}
              />
            </div>

            <div className="more-filters-row more-filters-row--triple">
              <MultiSelectTrigger
                label="Degree"
                isOpen={openMultiFilter === "degree"}
                selectedValues={selectedDegrees}
                onToggle={() => {
                  setOpenMultiFilter((value) => (value === "degree" ? null : "degree"));
                }}
              >
                {openMultiFilter === "degree" ? (
                  <MultiSelectPanel
                    title="Degree"
                    options={degreeOptions}
                    searchValue={degreeSearch}
                    selectedValues={selectedDegrees}
                    onChange={setSelectedDegrees}
                    onClose={() => setOpenMultiFilter(null)}
                    onSave={() => setOpenMultiFilter(null)}
                    onSearchChange={setDegreeSearch}
                  />
                ) : null}
              </MultiSelectTrigger>

              <MultiSelectTrigger
                label="Course Type"
                isOpen={openMultiFilter === "programType"}
                selectedValues={selectedProgramTypes}
                onToggle={() => {
                  setOpenMultiFilter((value) => (value === "programType" ? null : "programType"));
                }}
              >
                {openMultiFilter === "programType" ? (
                  <MultiSelectPanel
                    title="Course Type"
                    options={programTypeOptions}
                    searchValue={programTypeSearch}
                    selectedValues={selectedProgramTypes}
                    onChange={setSelectedProgramTypes}
                    align="right"
                    onClose={() => setOpenMultiFilter(null)}
                    onSave={() => setOpenMultiFilter(null)}
                    onSearchChange={setProgramTypeSearch}
                  />
                ) : null}
              </MultiSelectTrigger>

              <LabeledSelect
                label="Course Duration"
                options={durationOptions}
                value={selectedDurations[0] ?? ""}
                onOpen={closeOpenPanels}
                onChange={(value) => setSelectedDurations(value ? [value] : [])}
              />
            </div>

            <div className="more-filters-row">
              <ColumnToggles visibleColumns={visibleColumns} onChange={setVisibleColumns} />
            </div>
          </div>
        ) : null}

        <div className="filter-meta">
          <span>
            {loading ? "Loading" : `${filteredRows.length.toLocaleString("en-IN")} results`}
            {enteredRankNumber ? ` - rank ${formatRank(enteredRankNumber)}` : ""}
          </span>
        </div>

        <div className="filter-search-row">
          <label className="search-box">
            <Search size={16} />
            <input
              placeholder="Search visible results"
              value={tableSearch}
              onChange={(event) => setTableSearch(event.target.value)}
            />
          </label>
        </div>

      </section>

      {showFilterJump ? (
        <button
          className="mobile-scroll-to-filters-button"
          type="button"
          aria-label="Scroll to filters"
          onClick={() => {
            document.getElementById("jee-advanced-filters")?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }}
        >
          <ChevronUp size={20} />
        </button>
      ) : null}

      <section className="results-shell">
        {error ? <div className="empty-state">{error}</div> : null}

        {!error && loading ? (
          <div className="empty-state">
            <Loader2 className="inline animate-spin" size={18} /> Loading
          </div>
        ) : null}

        {!error && !loading && filteredRows.length === 0 ? (
          <div className="empty-state">No matching cutoffs</div>
        ) : null}

        {!error && !loading && filteredRows.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="results-table">
                <thead>
                  <tr>
                    {visibleColumns.map((column) => (
                      <th className={`col-${column}`} key={column}>
                        {columnLabels[column]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      {visibleColumns.map((column) => (
                        <td className={`col-${column}`} key={column}>
                          {renderCell(row, column, enteredRankNumber)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-results">
              {filteredRows.map((row) => (
                <article className="result-card" key={row.id}>
                  <div className="result-card__head">
                    <div>
                      <h3>{shortenInstituteName(row.institute)}</h3>
                      <p>{programShortName(row.program)}</p>
                    </div>
                    <span className="rank-badge">{formatRank(row.closingRankRaw)}</span>
                  </div>

                  <div className="card-fields">
                    {visibleColumns
                      .filter((column) => column !== "institute" && column !== "program")
                      .map((column) => (
                        <span className="card-field" key={column}>
                          <span>{columnLabels[column]}</span>
                          <b>{renderCell(row, column, enteredRankNumber)}</b>
                        </span>
                      ))}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
