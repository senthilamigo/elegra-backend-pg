/**
 * File: src/types/expense.ts
 * Path: src/types/expense.ts
 *
 * TypeScript interfaces mirroring the expenses table.
 *
 * expenses table columns (from sql/expenses.sql):
 *   id           UUID PRIMARY KEY DEFAULT uuid_generate_v4()
 *   seller_id    UUID NOT NULL REFERENCES sellers(id)
 *   title        VARCHAR(255)
 *   description  TEXT
 *   amount       NUMERIC(12,2) NOT NULL
 *   expense_type VARCHAR(50)   -- travel, stall, logistics, misc
 *   expense_date DATE NOT NULL
 *   created_by   UUID REFERENCES auth.users(id)
 *   created_at   TIMESTAMPTZ DEFAULT now()
 *
 * Access model:
 *   - seller: can only access expenses where expenses.seller_id matches
 *             their linked seller profile.
 *   - admin:  can access all expenses; can also filter by seller_id.
 */

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

/**
 * Valid values for expenses.expense_type.
 * Mirrors the application-level enum referenced in the SQL comments.
 *   travel    — transportation, accommodation, etc.
 *   stall     — trade stall / exhibition booth costs
 *   logistics — warehousing, shipping, handling
 *   misc      — any other operational expense
 */
export type ExpenseType = "travel" | "stall" | "logistics" | "misc";

// ─────────────────────────────────────────────
// Core DB row interface
// ─────────────────────────────────────────────

/**
 * Mirrors every column in the expenses table exactly.
 * Used as the return type for all expense query results.
 */
export interface Expense {
  /** UUID PRIMARY KEY — auto-generated */
  id: string;

  /** UUID FK → sellers(id) — the seller this expense belongs to */
  seller_id: string;

  /** Short human-readable title for the expense (VARCHAR 255, nullable) */
  title: string | null;

  /** Detailed description of the expense (TEXT, nullable) */
  description: string | null;

  /** Monetary amount — NUMERIC(12,2), always required */
  amount: number;

  /**
   * Category of expense.
   * One of: 'travel' | 'stall' | 'logistics' | 'misc'
   * Stored as VARCHAR(50) in DB; nullable if not categorised.
   */
  expense_type: ExpenseType | null;

  /**
   * Calendar date of the expense — stored as DATE (YYYY-MM-DD) in DB.
   * Returned as an ISO date string from Supabase.
   */
  expense_date: string;

  /** UUID of the auth.users row who created this record (nullable) */
  created_by: string | null;

  /** TIMESTAMPTZ — ISO string from Supabase, set on insert */
  created_at: string;
}
