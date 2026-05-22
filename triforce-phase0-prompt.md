# Triforce Phase 0 — Claude Code Hand-Off Prompt

Copy everything below the line and paste it into your Claude Code terminal session.

---

I am the Product Manager for Project "Triforce" — a multi-agent development orchestrator. I have final architectural sign-off from my supervisor to build Phase 0: a proof-of-concept CLI pipeline. I do not have deep coding experience. You are my developer. Please handle all file creation, package setup, and dependency installation autonomously.

There is a scope document in this directory called Triforce_Project_Scope_v1.1.docx — that is the full project blueprint. Phase 0 is what we are building right now.

Here is the exact build specification:

1. PROJECT SETUP (Milestone P0.1):
   - Initialize a Node.js project with package name "triforce" and version "0.1.0".
   - Install these dependencies: @google/genai, @anthropic-ai/sdk, dotenv.
   - Create a .env file with these placeholders (include a comment warning me to fill them in before running):
     ```
     # ⚠️ FILL THESE IN WITH YOUR REAL API KEYS BEFORE RUNNING ⚠️
     ANTHROPIC_API_KEY=
     GEMINI_API_KEY=
     ```
   - Create a .gitignore that excludes node_modules, .env, and sandbox.js.

2. MODEL CONFIGURATION (Milestone P0.6):
   - All model strings must be read from environment variables with these defaults:
     * ARCHITECT_MODEL defaults to 'claude-sonnet-4-6'
     * DEVELOPER_MODEL defaults to 'gemini-3.5-flash'
     * REVIEWER_MODEL defaults to 'gemini-3.5-flash'
   - This means I can swap models by editing .env without touching code.

3. PIPELINE LOGIC — orchestrator.js (Milestones P0.2 through P0.5):

   The script should define a sample task at the top of the file (something simple like "Create a JavaScript function that takes an array of numbers, removes duplicates, sorts them in ascending order, and returns the result. Include a test that proves it works.").

   Then execute these four stages in sequence:

   STAGE 1 — ARCHITECT (P0.2):
   - Send the task to the Claude model configured as "Architect".
   - System prompt: "You are the Architect agent in the Triforce system. Your job is to analyze a coding task and produce a clear, structured implementation plan. Output ONLY the plan as numbered steps. No code. No markdown formatting. No preamble."
   - Print the plan to console with a clear header: "=== STAGE 1: ARCHITECT (Claude) ==="

   STAGE 2 — DEVELOPER (P0.3):
   - Send the Architect's plan to the Gemini model configured as "Developer".
   - System prompt: "You are the Developer agent in the Triforce system. You receive an implementation plan and your job is to write the code. Output ONLY valid, executable JavaScript. No markdown code fences. No explanatory text. No comments unless they are inline code comments. The code must run directly with Node.js."
   - Print the code to console with header: "=== STAGE 2: DEVELOPER (Gemini) ==="
   - IMPORTANT: Strip any markdown code fences (```javascript or ```) from the response if the model includes them despite the instruction.

   STAGE 3 — SANDBOX EXECUTION (P0.4):
   - Write the Developer's code output to a file called sandbox.js.
   - Execute it using Node's child_process.exec() with a 10-second timeout.
   - Capture both stdout and stderr.
   - Print results with header: "=== STAGE 3: SANDBOX EXECUTION ==="

   STAGE 4 — REVIEWER (P0.5):
   - Send BOTH the generated code AND the execution results to the Gemini model configured as "Reviewer".
   - System prompt: "You are the Reviewer agent in the Triforce system. You receive code written by another agent and the terminal output from executing that code. Analyze both and produce a clear Pass/Fail verdict. If Pass: confirm what worked. If Fail: identify exactly what went wrong and what should be fixed. Be concise and specific."
   - Print the review with header: "=== STAGE 4: REVIEWER (Gemini) ==="

4. ERROR HANDLING:
   - If any API call fails, print a clear error message identifying which stage failed and why, then exit gracefully.
   - If sandbox.js execution fails or times out, still proceed to the Reviewer stage — pass the error output so the Reviewer can diagnose it.

5. FINAL OUTPUT:
   - After all four stages complete, print a summary line:
     "=== TRIFORCE PHASE 0 COMPLETE ==="
   - Include the total execution time.

Please build everything, run npm install, and do a quick syntax check. Let me know when the files are ready for me to insert my API keys and run the pipeline.
