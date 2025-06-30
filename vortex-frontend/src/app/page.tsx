"use client";

import { useState } from "react";

export default function CallbackPage() {
  const [email, setEmail] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(
        "https://ryslx106w5.execute-api.us-east-1.amazonaws.com/register-email",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, githubUsername }),
        }
      );

      if (response.ok) {
        setSubmitted(true);
      } else {
        alert("There was an error. Please try again.");
      }
    } catch {
      alert("There was an error. Please try again.");
    }

    setLoading(false);
  };

  if (submitted) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center p-4 border rounded shadow">
        <h2 className="text-2xl font-semibold mb-4">✅ You&apos;re all set!</h2>
        <p>You can now close this tab and continue coding.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-20 p-4 border rounded shadow">
      <h2 className="text-2xl font-semibold mb-4">Set Up Email Reports</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-1">GitHub Username</label>
          <input
            type="text"
            required
            value={githubUsername}
            onChange={(e) => setGithubUsername(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block mb-1">Email Address</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          {loading ? "Submitting..." : "Submit"}
        </button>
      </form>
    </div>
  );
}
