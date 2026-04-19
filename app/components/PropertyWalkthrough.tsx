"use client";

import { useState, useEffect } from "react";
import { Joyride, EventData, STATUS, Step, EVENTS, ACTIONS } from "react-joyride";

export type Tab = "Fields" | "Questions" | "Rules" | "Links" | "AI Behavior";

export function PropertyWalkthrough({
  run,
  onFinish,
  setActiveTab,
}: {
  run: boolean;
  onFinish: () => void;
  setActiveTab: (tab: Tab) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);

  const steps: Step[] = [
    {
      target: "body",
      placement: "center",
      content: (
        <div className="text-left space-y-2">
          <h3 className="font-bold text-teal-900">Welcome to your new property!</h3>
          <p className="text-sm text-gray-700">Let&apos;s take a quick 1-minute tour to see how you can set up AI screening fast.</p>
        </div>
      ),
      skipBeacon: true,
    },
    {
      target: "#tour-property-details",
      content: (
        <div className="text-left space-y-2">
          <h3 className="font-bold text-teal-900">1. Property Details</h3>
          <p className="text-sm text-gray-700">First, name your property and paste your lease requirements here. The AI will use this context later.</p>
        </div>
      ),
      skipBeacon: true,
    },
    {
      target: "#tour-tab-questions",
      content: (
        <div className="text-left space-y-2">
          <h3 className="font-bold text-teal-900">2. Interview Flow</h3>
          <p className="text-sm text-gray-700">The Questions tab is where you define the flow for applicants to follow.</p>
        </div>
      ),
      skipBeacon: true,
    },
    {
      target: "#tour-generate-questions",
      content: (
        <div className="text-left space-y-2">
          <h3 className="font-bold text-teal-900">Generate Questions</h3>
          <p className="text-sm text-gray-700">Type something like <strong>&quot;Occupants, income, pets, move-in&quot;</strong> and click Generate to have the AI scaffold questions for you.</p>
        </div>
      ),
      skipBeacon: true,
    },
    {
      target: "#tour-tab-rules",
      content: (
        <div className="text-left space-y-2">
          <h3 className="font-bold text-teal-900">3. Screening Rules</h3>
          <p className="text-sm text-gray-700">Rules silently evaluate the data collected from applicants. Let&apos;s look inside.</p>
        </div>
      ),
      skipBeacon: true,
    },
    {
      target: "#tour-generate-rules",
      content: (
        <div className="text-left space-y-2">
          <h3 className="font-bold text-teal-900">Generate Rules</h3>
          <p className="text-sm text-gray-700">Type something like <strong>&quot;No smoking; income 3x rent&quot;</strong> and let the AI generate reject or require conditions for you.</p>
        </div>
      ),
      skipBeacon: true,
    },
    {
      target: "#tour-publish-btn",
      content: (
        <div className="text-left space-y-2">
          <h3 className="font-bold text-teal-900">4. Publish & Share</h3>
          <p className="text-sm text-gray-700">Once you&apos;re happy with your questions and rules, click Publish. Now you can share the applicant link!</p>
        </div>
      ),
      skipBeacon: true,
    },
  ];

  const handleCallback = (data: EventData) => {
    const { status, type, action, index } = data;

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setStepIndex(0);
      onFinish();
      return;
    }

    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);
      
      // Before updating step index, handle tab switching
      if (nextIndex === 3) {
        setActiveTab("Questions");
        // Add a slight delay for react to render the tab before advancing joyride
        setTimeout(() => setStepIndex(nextIndex), 50);
      } else if (nextIndex === 5) {
        setActiveTab("Rules");
        setTimeout(() => setStepIndex(nextIndex), 50);
      } else {
        setStepIndex(nextIndex);
      }
    }
  };

  return (
    <Joyride
      steps={steps}
      run={run}
      stepIndex={stepIndex}
      onEvent={handleCallback}
      continuous
      scrollToFirstStep
    />
  );
}
