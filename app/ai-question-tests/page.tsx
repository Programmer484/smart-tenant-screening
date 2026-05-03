"use client";

import { useState, useEffect } from "react";
import type { TestCase } from "@/lib/testing/aiQuestionTestCases";
import type { TestResult } from "@/lib/testing/runner";
import { ProposalReviewContent } from "@/app/components/RuleProposalModal";
import type { Proposal } from "@/app/components/RuleProposalModal";

export default function AiQuestionTestsPage() {
  const [tests, setTests] = useState<Omit<TestCase, "mockOutput">[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/testing/run")
      .then((res) => res.json())
      .then((data) => {
        if (data.tests) {
          setTests(data.tests);
        }
      })
      .catch((err) => console.error("Failed to load tests", err));
  }, []);

  const handleToggle = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === tests.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tests.map((t) => t.id)));
    }
  };

  const runSelected = async () => {
    if (selectedIds.size === 0) return;
    
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/testing/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testIds: Array.from(selectedIds) }),
      });
      const data = await res.json();
      
      if (data.error) {
        setError(data.error);
      } else if (data.results) {
        setResults(data.results);
        if (data.results.length > 0) {
          setActiveTabId(data.results[0].testId);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const runAll = async () => {
    const allIds = tests.map(t => t.id);
    setSelectedIds(new Set(allIds));
    
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/testing/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testIds: allIds }),
      });
      const data = await res.json();
      
      if (data.error) {
        setError(data.error);
      } else if (data.results) {
        setResults(data.results);
        if (data.results.length > 0) {
          setActiveTabId(data.results[0].testId);
        }
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
        <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Question Generation Test Harness</h1>
        <p className="text-gray-600">
          Internal tool for verifying AI question generator outputs against strict requirements using an LLM evaluator.
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
              onClick={runSelected}
              disabled={selectedIds.size === 0 || running}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {running ? "Running..." : "Run Selected"}
            </button>
            <button
              onClick={runAll}
              disabled={running || tests.length === 0}
              className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {running ? "Running..." : "Run All"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 text-red-700 bg-red-50 rounded-lg">
            {error}
          </div>
        )}

        <div className="space-y-2">
          {tests.map((t) => (
            <label
              key={t.id}
              className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer"
            >
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
          ))}
        </div>
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200 overflow-x-auto bg-gray-50">
            {results.map((r) => (
              <button
                key={r.testId}
                onClick={() => setActiveTabId(r.testId)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium whitespace-nowrap border-b-2 ${
                  activeTabId === r.testId
                    ? "border-blue-600 text-blue-600 bg-white"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                <span>{r.success ? "✅" : "❌"}</span>
                {r.testName}
              </button>
            ))}
          </div>

          <div className="p-6">
            {results.map((r) => {
              if (r.testId !== activeTabId) return null;
              const testCase = tests.find((t) => t.id === r.testId);
              
              const mappedProposal: Proposal = {
                newRules: r.output?.newRules || [],
                modifiedRules: r.output?.modifiedRules || [],
                deletedRuleIds: r.output?.deletedRuleIds || [],
                newFields: r.output?.newFields || [],
                proposedQuestions: r.output?.questions || [],
                deletedQuestionIds: r.output?.deletedQuestionIds || [],
              };
              
              return (
                <div key={r.testId} className="space-y-8">
                  {/* Header / Top level status */}
                  <div className={`p-4 rounded-lg border ${r.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className={`text-lg font-bold ${r.success ? 'text-green-800' : 'text-red-800'}`}>
                        {r.success ? "Passed" : "Failed"}
                      </h3>
                      {r.evaluation && (
                        <span className={`px-3 py-1 rounded-full font-bold text-sm ${r.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          Score: {r.evaluation.score}/100
                        </span>
                      )}
                    </div>
                    {r.evaluation && (
                      <p className={r.success ? 'text-green-700' : 'text-red-700'}>
                        {r.evaluation.summary}
                      </p>
                    )}
                    {r.error && (
                      <p className="text-red-700 font-mono mt-2">{r.error}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                    {/* Left Column: Test Case Data and Evaluator Details */}
                    <div className="space-y-6">
                      <section>
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Test Case</h4>
                        <div className="bg-gray-50 p-4 rounded-lg space-y-4 text-sm">
                          <div>
                            <span className="font-semibold text-gray-700">Name:</span> {testCase?.name}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-700">Description:</span> {testCase?.description}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-700">Prompt:</span>
                            <div className="mt-1 p-3 bg-white border rounded text-gray-800 font-serif italic">
                              "{testCase?.prompt}"
                            </div>
                          </div>
                          {testCase?.variables && Object.keys(testCase.variables).length > 0 && (
                            <div>
                              <span className="font-semibold text-gray-700">Variables Context:</span>
                              <div className="mt-1 p-3 bg-white border rounded text-gray-800 font-mono text-xs">
                                {Object.entries(testCase.variables).map(([key, value]) => (
                                  <div key={key}>
                                    <span className="text-blue-600">{`{{${key}}}`}</span>: {value}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div>
                            <span className="font-semibold text-gray-700">Requirements:</span>
                            <ul className="list-disc pl-5 mt-1 space-y-1">
                              {testCase?.requirements.map((req, i) => (
                                <li key={i} className="text-gray-800">{req}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </section>

                      {r.evaluation && (
                        <section>
                          <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Evaluation Details</h4>
                          
                          {r.evaluation.failedRequirements.length > 0 && (
                            <div className="mb-4">
                              <h5 className="font-medium text-red-800 flex items-center gap-2">
                                ❌ Failed Requirements
                              </h5>
                              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-red-700 bg-red-50 p-3 rounded-lg">
                                {r.evaluation.failedRequirements.map((req, i) => (
                                  <li key={i}>{req}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {r.evaluation.passedRequirements.length > 0 && (
                            <div className="mb-4">
                              <h5 className="font-medium text-green-800 flex items-center gap-2">
                                ✅ Passed Requirements
                              </h5>
                              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-green-700 bg-green-50 p-3 rounded-lg">
                                {r.evaluation.passedRequirements.map((req, i) => (
                                  <li key={i}>{req}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {r.evaluation.concerns.length > 0 && (
                            <div className="mb-4">
                              <h5 className="font-medium text-yellow-800 flex items-center gap-2">
                                ⚠️ Concerns (Even if Passed)
                              </h5>
                              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-yellow-700 bg-yellow-50 p-3 rounded-lg">
                                {r.evaluation.concerns.map((req, i) => (
                                  <li key={i}>{req}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {r.evaluation.suggestedFixes.length > 0 && (
                            <div>
                              <h5 className="font-medium text-blue-800 flex items-center gap-2">
                                💡 Suggested Fixes
                              </h5>
                              <ul className="list-disc pl-5 mt-2 space-y-1 text-sm text-blue-700 bg-blue-50 p-3 rounded-lg">
                                {r.evaluation.suggestedFixes.map((req, i) => (
                                  <li key={i}>{req}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </section>
                      )}
                    </div>

                    {/* Right Column: Generated Output UI */}
                    <div className="sticky top-6">
                      <section>
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">Generated Output</h4>
                        <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                          <ProposalReviewContent 
                            proposal={mappedProposal}
                            existingRules={[]}
                            existingQuestions={[]}
                            existingFields={[]}
                            showActions={false}
                          />
                        </div>
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
