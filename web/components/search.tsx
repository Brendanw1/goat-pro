"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ThinkingOrb } from "thinking-orbs";
import {
  buildSearchIndex,
  searchIndex,
  type SearchEntry,
  type SearchIndex as SearchIndexType,
} from "@/lib/search-index";

type Player = { id: string; name: string; team: string };
type Lists = { hitters: Player[]; pitchers: Player[] };

/**
 * The player list comes from /api/data/search-index (browser-cached), loaded the first time the box is hovered or
 * focused. It used to be embedded in every page by the dashboard layout (~1.5 MB of HTML per page load).
 */
let listsPromise: Promise<Lists> | null = null;
function loadLists(): Promise<Lists> {
  listsPromise ??= fetch("/api/data/search-index")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((b: { h: [string, string, string][]; p: [string, string, string][] }) => {
      const rows = (xs: [string, string, string][]) => xs.map(([id, name, team]) => ({ id, name, team }));
      return { hitters: rows(b.h), pitchers: rows(b.p) };
    })
    .catch((e) => { listsPromise = null; throw e; });   // a failed load is retried on the next focus
  return listsPromise;
}

let indexPromise: Promise<SearchIndexType> | null = null;
const loadIndex = () => (indexPromise ??= loadLists().then((l) => buildSearchIndex(l.hitters, l.pitchers))
  .catch((e) => { indexPromise = null; throw e; }));
const warm = () => { loadIndex().catch(() => {}); };

export function Search() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const handleSearch = useCallback(
    (value: string) => {
      if (value.trim().length === 0) {
        setResults([]);
        setIsOpen(false);
        setIsSearching(false);
        return;
      }

      // waits for the player list on the first search (it is usually already warm from hover/focus)
      loadIndex().then((index) => {
        const matches = searchIndex(index, value, 8);
        setResults(matches);
        setIsOpen(matches.length > 0);
        setIsSearching(false);
        setSelectedIndex(-1);
      }).catch(() => setIsSearching(false));
    },
    []
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (value.trim().length > 0) {
        setIsSearching(true);
        debounceRef.current = setTimeout(() => {
          handleSearch(value);
        }, 300);
      } else {
        setResults([]);
        setIsOpen(false);
        setIsSearching(false);
      }
    },
    [handleSearch]
  );

  const handleSelect = useCallback(
    (entry: SearchEntry) => {
      setQuery("");
      setResults([]);
      setIsOpen(false);
      setIsSearching(false);
      router.push(`/player/${entry.id}`);
    },
    [router]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        // Enter with nothing highlighted goes to the best match; waiting for an
        // ArrowDown first made the most natural gesture do nothing.
        const pick = selectedIndex >= 0 ? results[selectedIndex] : results[0];
        if (pick) handleSelect(pick);
      } else if (e.key === "Escape") {
        setIsOpen(false);
        setQuery("");
        inputRef.current?.blur();
      }
    },
    [isOpen, results, selectedIndex, handleSelect]
  );

  // A new result set can be shorter than the old one; keep the highlight in range.
  useEffect(() => {
    setSelectedIndex((i) => (results.length === 0 ? -1 : Math.min(i, results.length - 1)));
  }, [results]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            warm();
            if (results.length > 0) setIsOpen(true);
          }}
          onPointerEnter={warm}
          placeholder="Search players..."

          aria-label="Search players"
          className="
            w-36 sm:w-44 xl:w-56 px-3 py-1.5 rounded-lg text-sm
            bg-white/[0.05] border border-border-subtle
            text-text-secondary placeholder:text-text-dim
            focus:border-border-emphasis focus:bg-white/[0.08]
            transition-all duration-200 pr-8
          "
        />
        {/* Loading indicator */}
        {isSearching && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <ThinkingOrb size={20} state="searching" theme="dark" />
          </div>
        )}
      </div>

      {/* Dropdown Results */}
      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute top-full right-0 mt-2 w-72 overflow-hidden animate-in z-50 rounded-xl border border-border-default"
          style={{
            background: "rgba(8, 11, 10, 0.95)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 12px 48px rgba(0,0,0,0.7), 0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          {results.map((entry, i) => (
            <button
              key={`${entry.type}-${entry.id}`}
              onClick={() => handleSelect(entry)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-100
                ${i === selectedIndex ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}
                ${i < results.length - 1 ? "border-b border-border-subtle" : ""}
              `}
            >
              {/* Type indicator */}
              <div
                className={`
                  w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                  ${
                    entry.type === "pitcher"
                      ? "bg-pitch-fastball/20 text-pitch-fastball"
                      : "bg-usf-gold/20 text-usf-gold"
                  }
                `}
              >
                {entry.type === "pitcher" ? "P" : "H"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary truncate">
                  {entry.name}
                </div>
                <div className="text-[10px] text-text-dim">
                  {entry.team}
                  {entry.position ? ` · ${entry.position}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
