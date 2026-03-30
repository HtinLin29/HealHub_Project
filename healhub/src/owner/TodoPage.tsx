import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import OwnerLayout from './OwnerLayout';
import { supabase } from '../services/supabaseClient';
import {
  buildTodoSuggestions,
  createOwnerTodo,
  deleteOwnerTodo,
  listOwnerTodos,
  updateOwnerTodo,
  type OwnerTodo,
  type OwnerTodoPriority,
  type TodoSuggestion,
} from '../services/ownerTodoService';
import { useTheme } from '../context/ThemeContext';

type FilterTab = 'open' | 'done' | 'all';

/** Supabase/PostgREST errors are plain objects with `.message`, not always `Error`. */
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function formatLoadError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes('relation') && lower.includes('does not exist')) {
    return `${msg}\n\nCreate the table: open Supabase → SQL → run healhub/supabase/owner_todos_migration.sql`;
  }
  if (lower.includes('permission denied') || lower.includes('row-level security') || lower.includes('rls')) {
    return `${msg}\n\nCheck RLS policies for owner_todos (see healhub/supabase-rls.sql).`;
  }
  return msg;
}

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function priorityDot(priority: OwnerTodoPriority) {
  if (priority === 'high') return 'bg-rose-500';
  if (priority === 'low') return 'bg-slate-400';
  return 'bg-amber-400';
}

function fmtDue(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function TodoPage() {
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const [todos, setTodos] = useState<OwnerTodo[]>([]);
  const [suggestions, setSuggestions] = useState<TodoSuggestion[]>([]);
  const [filter, setFilter] = useState<FilterTab>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  /** Separate from `busyId` so Delete can show "Deleting…" while toggle uses the same row id. */
  const [deleteBusyId, setDeleteBusyId] = useState<number | null>(null);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<OwnerTodoPriority>('normal');
  const [dueAt, setDueAt] = useState('');
  const [suggestionWarning, setSuggestionWarning] = useState('');

  const load = useCallback(async () => {
    const rows = await listOwnerTodos();
    setTodos(rows);
    setSuggestionWarning('');
    try {
      setSuggestions(await buildTodoSuggestions(rows));
    } catch (e: unknown) {
      setSuggestions([]);
      setSuggestionWarning(getErrorMessage(e) || 'Could not load suggestions (your task list still works).');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load()
      .then(() => setError(''))
      .catch((e: unknown) => {
        setError(formatLoadError(getErrorMessage(e) || 'Could not load tasks'));
      })
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('owner-todos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'owner_todos' }, () => {
        void load().catch(() => {});
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return todos;
    return todos.filter((t) => t.status === filter);
  }, [todos, filter]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    try {
      setBusyId(-1);
      setError('');
      await createOwnerTodo({
        title: t,
        notes: notes.trim() || null,
        priority,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        source: 'manual',
      });
      setTitle('');
      setNotes('');
      setPriority('normal');
      setDueAt('');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add task');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleDone(todo: OwnerTodo) {
    try {
      setBusyId(todo.id);
      setError('');
      await updateOwnerTodo(todo.id, { status: todo.status === 'open' ? 'done' : 'open' });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: number) {
    try {
      setDeleteBusyId(id);
      setError('');
      await deleteOwnerTodo(id);
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to delete');
    } finally {
      setDeleteBusyId(null);
    }
  }

  async function addSuggestion(s: TodoSuggestion) {
    try {
      setBusyId(-2);
      setError('');
      await createOwnerTodo({
        title: s.title,
        notes: s.subtitle,
        priority: s.priority,
        source: 'suggested',
        linked_type: s.linked_type,
        linked_id: s.linked_id,
      });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add';
      if (msg.includes('duplicate') || msg.includes('unique')) {
        setError('This item is already on your open list.');
      } else {
        setError(msg);
      }
    } finally {
      setBusyId(null);
    }
  }

  const tabBtn = (id: FilterTab, label: string) => (
    <button
      type="button"
      key={id}
      onClick={() => setFilter(id)}
      className={cx(
        'rounded-full px-4 py-2 text-sm font-semibold transition',
        filter === id
          ? 'bg-indigo-600 text-white shadow-sm'
          : isDark
            ? 'bg-slate-700/80 text-slate-200 hover:bg-slate-700'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
      )}
    >
      {label}
    </button>
  );

  return (
    <OwnerLayout title="To-do">
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Tasks</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Saved to your database. Suggested items come from low stock, pending refunds, and unpaid orders.
          </p>
        </div>

        {error ? (
          <div className="whitespace-pre-line rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        {suggestionWarning && !error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            {suggestionWarning}
          </div>
        ) : null}

        <form onSubmit={handleAdd} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-600 dark:bg-slate-800/50">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">New task</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
              Priority
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as OwnerTodoPriority)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
              Due (optional)
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <button
              type="submit"
              disabled={!title.trim() || busyId === -1}
              className="ml-auto rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {busyId === -1 ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </form>

        {suggestions.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Suggested</h2>
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li
                  key={s.key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200/80 bg-indigo-50/60 px-4 py-3 dark:border-indigo-500/30 dark:bg-indigo-950/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 dark:text-white">{s.title}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{s.subtitle}</p>
                    <Link to={s.linkTo} className="mt-1 inline-block text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                      Open related page →
                    </Link>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === -2}
                    onClick={() => void addSuggestion(s)}
                    className="shrink-0 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Add to list
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          {tabBtn('open', 'Open')}
          {tabBtn('done', 'Done')}
          {tabBtn('all', 'All')}
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
            No tasks in this view.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((todo) => {
              const rowBusy = busyId === todo.id || deleteBusyId === todo.id;
              const isDeleting = deleteBusyId === todo.id;
              return (
              <li
                key={todo.id}
                className={cx(
                  'flex flex-wrap items-start gap-3 rounded-2xl border px-4 py-3 shadow-sm transition-opacity',
                  todo.status === 'done'
                    ? 'border-slate-200 bg-slate-50/80 opacity-80 dark:border-slate-700 dark:bg-slate-800/40'
                    : 'border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800/80',
                  isDeleting && 'pointer-events-none opacity-60',
                )}
              >
                <button
                  type="button"
                  aria-label={todo.status === 'done' ? 'Mark open' : 'Mark done'}
                  aria-busy={busyId === todo.id && !isDeleting}
                  disabled={rowBusy}
                  onClick={() => void toggleDone(todo)}
                  className={cx(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-xs',
                    todo.status === 'done'
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-300 dark:border-slate-500',
                  )}
                >
                  {todo.status === 'done' ? '✓' : ''}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', priorityDot(todo.priority))} aria-hidden />
                    <span
                      className={cx(
                        'font-medium text-slate-900 dark:text-white',
                        todo.status === 'done' && 'line-through',
                      )}
                    >
                      {todo.title}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {todo.source === 'suggested' ? 'Suggested' : 'Manual'}
                    </span>
                  </div>
                  {todo.notes ? (
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{todo.notes}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                    {fmtDue(todo.due_at) ? <span>Due {fmtDue(todo.due_at)}</span> : null}
                    {todo.completed_at ? <span>Completed {fmtDue(todo.completed_at)}</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  aria-busy={isDeleting}
                  disabled={rowBusy}
                  onClick={() => void remove(todo.id)}
                  className="shrink-0 min-w-[5.5rem] text-sm font-medium text-rose-600 hover:text-rose-700 disabled:cursor-wait dark:text-rose-400"
                >
                  {isDeleting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-rose-500 border-t-transparent dark:border-rose-400"
                        aria-hidden
                      />
                      Deleting…
                    </span>
                  ) : (
                    'Delete'
                  )}
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </OwnerLayout>
  );
}
