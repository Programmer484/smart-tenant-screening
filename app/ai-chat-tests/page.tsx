"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ChatTestCase } from "@/lib/testing/chatTestCases";
import type { ChatTestResult } from "@/lib/testing/chatRunner";

function PropertySummary({ property }: { property: ChatTestCase["property"] }) {
  return (
    <div className="bg-gray-50 p-3 rounded-lg space-y-2 text-xs font-mono">
      {property.title && <div><span className="text-gray-500">title:</span> {property.title}</div>}
      <div>
        <span className="text-gray-500">fields:</span>
        <ul className="ml-4 list-disc">
          {property.fields.map((f) => (
            <li key={f.id}>{f.id} ({f.value_kind})</li>
          ))}
        </ul>
      </div>
      <div>
        <span className="text-gray-500">questions:</span>
        <ol className="ml-4 list-decimal">
          {property.questions.map((q) => (
            <li key={q.id}>"{q.text}" → [{q.fieldIds.join(", ")}]
              {q.branches.length > 0 && (
                <ul className="ml-3 list-disc">
                  {q.branches.map((b) => (
                    <li key={b.id} className="text-amber-700">
                      if {b.condition.fieldId} {b.condition.operator} {b.condition.value} → {b.outcome}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>
      {property.rules && property.rules.length > 0 && (
        <div>
          <span className="text-gray-500">rules:</span>
          <ul className="ml-4 list-disc">
            {property.rules.map((r) => (
              <li key={r.id}>
                {r.kind}: {r.conditions.map((c) => `${c.fieldId} ${c.operator} ${c.value}`).join(" AND ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {property.aiInstructions && Object.keys(property.aiInstructions).length > 0 && (
        <div>
          <span className="text-gray-500">aiInstructions:</span>
          <pre className="ml-4 whitespace-pre-wrap text-[10px]">{JSON.stringify(property.aiInstructions, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function TestCaseDetails({ testCase }: { testCase: ChatTestCase }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <span className="font-semibold text-gray-700">Description:</span> {testCase.description}
      </div>
      <div>
        <span className="font-semibold text-gray-700">Property fixture:</span>
        <PropertySummary property={testCase.property} />
      </div>
      {testCase.initialAnswers && Object.keys(testCase.initialAnswers).length > 0 && (
        <div>
          <span className="font-semibold text-gray-700">Initial answers:</span>
          <pre className="mt-1 bg-gray-50 p-2 rounded text-xs">{JSON.stringify(testCase.initialAnswers, null, 2)}</pre>
        </div>
      )}
      <div>
        <span className="font-semibold text-gray-700">User messages (in order):</span>
        <ol className="mt-1 list-decimal ml-5 space-y-1">
          {testCase.userMessages.map((m, i) => (
            <li key={i} className="text-gray-800 italic">"{m}"</li>
          ))}
        </ol>
      </div>
      <div>
        <span className="font-semibold text-gray-700">Requirements:</span>
        <ul className="list-disc pl-5 mt-1 space-y-1">
          {testCase.requirements.map((req, i) => (
            <li key={i} className="text-gray-800">{req}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TranscriptView({ result }: { result: ChatTestResult }) {
  if (!result.turns || result.turns.length === 0) {
    return <p className="text-sm text-gray-500 italic">No turns recorded.</p>;
  }
  return (
    <div className="space-y-3">
      {result.turns.map((t, i) => (
        <div key={i} className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
            Turn {i + 1} · status: <span className="text-gray-900">{t.sessionStatus}</span>
          </div>
          <div className="p-3 space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-blue-600 font-semibold">User</div>
              <div className="text-sm text-gray-800 italic">"{t.userMessage}"</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-teal-700 font-semibold">Assistant</div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap">{t.assistantReply}</div>
            </div>
            {t.extracted.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-purple-700 font-semibold">Extracted</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {t.extracted.map((ex, j) => (
                    <span key={j} className="text-[10px] rounded bg-purple-50 border border-purple-200 px-1.5 py-0.5 font-mono text-purple-800">
                      {ex.fieldId} = {ex.value}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
      {result.finalAnswers && Object.keys(result.finalAnswers).length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 mb-1">Final Answers</div>
          <pre className="text-xs font-mono">{JSON.stringify(result.finalAnswers, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default function AiChatTestsPage() {
  const [tests, setTests] = useState<ChatTestCase[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ChatTestResult[]>([]);
  const [openedIds, setOpenedIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/testing/run-chat")
      .then((res) => res.json())
      .then((data) => {
        if (data.tests) setTests(data.tests);
      })
      .catch((err) => console.error("Failed to load chat tests", err));
  }, []);

  const openTab = (id: string) => {
    setOpenedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveTabId(id);
  };

  const mergeResultIds = (newResults: ChatTestResult[]) => {
    setOpenedIds((prev) => {
      const toAdd = newResults.map((r) => r.testId).filter((id) => !prev.includes(id));
      return [...prev, ...toAdd];
    });
  };

  const handleToggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === tests.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(tests.map((t) => t.id)));
  };

  const runTests = async (ids: string[]) => {
    if (ids.length === 0) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/testing/run-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testIds: ids }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.results) {
        setResults((prev) => {
          const merged = [...prev];
          for (const r of data.results as ChatTestResult[]) {
            const idx = merged.findIndex((x) => x.testId === r.testId);
            if (idx >= 0) merged[idx] = r;
            else merged.push(r);
          }
          return merged;
        });
        mergeResultIds(data.results);
        if (data.results.length > 0) setActiveTabId(data.results[0].testId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Chat Response Test Harness</h1>
          <Link href="/ai-question-tests" className="text-sm text-teal-700 hover:underline">
            → Question generation tests
          </Link>
        </div>
        <p className="text-gray-600">
          Verifies the tenant-facing chat assistant: outcomes, off-topic handling, multi-field extraction, style enforcement, and question flow. For debugging, not landlord use.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Available Test Cases</h2>
          <div className="flex gap-2">
            <button
              onClick={handleSelectAll}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
            >
              {selectedIds.size === tests.length ? "Deselect All" : "Select All"}
            </button>
            <button
              onClick={() => void runTests(Array.from(selectedIds))}
              disabled={selectedIds.size === 0 || running}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {running ? "Running..." : "Run Selected"}
            </button>
            <button
              onClick={() => void runTests(tests.map((t) => t.id))}
              disabled={running || tests.length === 0}
              className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {running ? "Running..." : "Run All"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 text-red-700 bg-red-50 rounded-lg">{error}</div>
        )}

        <div className="space-y-2">
          {tests.map((t) => (
            <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50">
              <label className="flex items-start gap-3 flex-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.has(t.id)}
                  onChange={() => handleToggle(t.id)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                />
                <div>
                  <div className="font-medium text-gray-900">{t.name}</div>
                  <div className="text-sm text-gray-500">{t.description}</div>
                </div>
              </label>
              <button
                onClick={() => openTab(t.id)}
                className="shrink-0 mt-0.5 px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200"
              >
                View
              </button>
            </div>
          ))}
        </div>
      </div>

      {openedIds.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200 overflow-x-auto bg-gray-50">
            {openedIds.map((id) => {
              const result = results.find((r) => r.testId === id);
              const test = tests.find((t) => t.id === id);
              return (
                <button
                  key={id}
                  onClick={() => setActiveTabId(id)}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-medium whitespace-nowrap border-b-2 ${
                    activeTabId === id
                      ? "border-blue-600 text-blue-600 bg-white"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {result ? (
                    <span>{result.success ? "✅" : "❌"}</span>
                  ) : (
                    <span className="text-gray-400 text-xs">○</span>
                  )}
                  {test?.name ?? id}
                </button>
              );
            })}
          </div>

          <div className="p-6">
            {openedIds.map((id) => {
              if (id !== activeTabId) return null;
              const r = results.find((rr) => rr.testId === id);
              const testCase = tests.find((t) => t.id === id);
              if (!testCase) return null;

              if (!r) {
                return (
                  <div key={id} className="space-y-6">
                    <div className="p-4 rounded-lg border bg-gray-50 border-gray-200 text-sm text-gray-500 italic">
                      Preview only — run this test to see the live transcript and evaluation.
                    </div>
                    <section>
                      <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Test Case</h4>
                      <TestCaseDetails testCase={testCase} />
                    </section>
                  </div>
                );
              }

              return (
                <div key={id} className="space-y-8">
                  <div className={`p-4 rounded-lg border ${r.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className={`text-lg font-bold ${r.success ? "text-green-800" : "text-red-800"}`}>
                        {r.success ? "Passed" : "Failed"}
                      </h3>
                      {r.evaluation && (
                        <span className={`px-3 py-1 rounded-full font-bold text-sm ${r.success ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                          Score: {r.evaluation.score}/100
                        </span>
                      )}
                    </div>
                    {r.evaluation && (
                      <p className={r.success ? "text-green-700" : "text-red-700"}>{r.evaluation.summary}</p>
                    )}
                    {r.error && <p className="text-red-700 font-mono mt-2">{r.error}</p>}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                    <div className="space-y-6">
                      <section>
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Test Case</h4>
                        <TestCaseDetails testCase={testCase} />
                      </section>

                      {r.evaluation && (
                        <section>
                          <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Evaluation Details</h4>
                          {r.evaluation.failedRequirements.length > 0 && (
                            <div className="mb-4">
                              <h5 className="font-medium text-red-800">❌ Failed Requirements</h5>
                              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-red-700 bg-red-50 p-3 rounded-lg">
                                {r.evaluation.failedRequirements.map((req, i) => <li key={i}>{req}</li>)}
                              </ul>
                            </div>
                          )}
                          {r.evaluation.passedRequirements.length > 0 && (
                            <div className="mb-4">
                              <h5 className="font-medium text-green-800">✅ Passed Requirements</h5>
                              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-green-700 bg-green-50 p-3 rounded-lg">
                                {r.evaluation.passedRequirements.map((req, i) => <li key={i}>{req}</li>)}
                              </ul>
                            </div>
                          )}
                          {r.evaluation.concerns.length > 0 && (
                            <div className="mb-4">
                              <h5 className="font-medium text-yellow-800">⚠️ Concerns</h5>
                              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-yellow-700 bg-yellow-50 p-3 rounded-lg">
                                {r.evaluation.concerns.map((c, i) => <li key={i}>{c}</li>)}
                              </ul>
                            </div>
                          )}
                          {r.evaluation.suggestedFixes.length > 0 && (
                            <div>
                              <h5 className="font-medium text-blue-800">💡 Suggested Fixes</h5>
                              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-blue-700 bg-blue-50 p-3 rounded-lg">
                                {r.evaluation.suggestedFixes.map((s, i) => <li key={i}>{s}</li>)}
                              </ul>
                            </div>
                          )}
                        </section>
                      )}
                    </div>

                    <div className="sticky top-6">
                      <section>
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Conversation Transcript</h4>
                        <TranscriptView result={r} />
                      </section>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
