# Error Analysis Integration Guide

This document is for the contributor implementing the AI error-analysis prompt and wiring its output into the backend.

## Goal

Generate structured JSON describing the user's problem-solving errors and send it to the backend endpoint:

`POST /api/assignments/:id/problems/:problemIndex/errors`

This is separate from hint generation. Do not mix hint text into this payload.

## Source Of Truth

The backend exposes the machine-readable contract at:

`GET /api/contracts/problem-errors`

If this guide and the endpoint contract differ, follow the endpoint contract.

## Required Workflow

1. Run the error-analysis prompt on the user's current work.
2. Parse the model output as JSON.
3. Validate that it matches the backend contract.
4. POST it to `/api/assignments/:id/problems/:problemIndex/errors`.
5. Treat a failed POST as a logging failure only. It should not break the user-facing hint flow.

## Important Separation

- Hint prompt: produces user-facing tutoring text.
- Error prompt: produces structured error JSON only.

The error prompt should not return prose for direct display to the user unless it is also mapped into the structured fields below.

## Payload Contract

Top-level fields:

- `source`: must be `"error_analysis"`
- `observedStep`: short string, max 220 chars
- `stage`: short string, max 80 chars
- `correctness`: one of `correct`, `incorrect`, `unclear`
- `confidence`: one of `low`, `medium`, `high`
- `hintLevel`: optional number, typically `1` to `4`
- `rawAnalysis`: optional object containing the original parsed model JSON
- `mistakes`: array of mistake objects

Mistake object fields:

- `errorType`: short string, max 40 chars
- `mistakeSummary`: required string, max 180 chars
- `whyWrong`: optional string, max 260 chars
- `suggestedFix`: optional string, max 260 chars
- `severity`: one of `low`, `medium`, `high`
- `topics`: array of lowercase strings, max 5 items
- `concepts`: array of lowercase strings, max 8 items

Rules enforced by the backend:

- At most 10 mistakes per request
- If `correctness` is `incorrect`, `mistakes` must contain at least one item
- Empty strings are trimmed away
- `topics` and `concepts` are lowercased and deduplicated

## Prompting Requirements

The model should be instructed to:

- Return JSON only
- Never wrap the JSON in markdown code fences
- Never include explanatory prose outside the JSON
- Use only these enum values:
  - `correctness`: `correct`, `incorrect`, `unclear`
  - `confidence`: `low`, `medium`, `high`
  - `severity`: `low`, `medium`, `high`
- Keep topic and concept labels short, lowercase, and reusable across many problems
- Prefer broad `topics` such as `algebra`, `geometry`, `calculus`
- Prefer narrower `concepts` such as `inverse operations`, `distribution`, `factoring`
- Return `mistakes: []` when no clear mistake is identifiable

## Recommended Prompt Constraint Block

Use a block like this in the error prompt:

```text
Return JSON only.

Do not use markdown.
Do not include any text before or after the JSON.

Rules:
- source must be "error_analysis"
- correctness must be one of: correct, incorrect, unclear
- confidence must be one of: low, medium, high
- severity must be one of: low, medium, high
- output at most 10 mistakes
- each mistake may contain at most 5 topics
- each mistake may contain at most 8 concepts
- observedStep must be concise
- stage must be concise
- topic and concept labels must be lowercase short phrases
- do not duplicate topics or concepts within the same mistake
- if correctness is incorrect, include at least one mistake
- if no clear mistake is identifiable, return mistakes as an empty array
```

## Example Valid Payload

```json
{
  "source": "error_analysis",
  "observedStep": "2x + 3 = 9, then x = 9 - 3 + 2",
  "stage": "equation solving",
  "correctness": "incorrect",
  "confidence": "high",
  "hintLevel": 2,
  "rawAnalysis": {
    "model": "error-analyzer-v1"
  },
  "mistakes": [
    {
      "errorType": "procedural",
      "mistakeSummary": "Applied inverse operations incorrectly",
      "whyWrong": "The term was not isolated using the same valid operation on both sides",
      "suggestedFix": "Subtract 3 from both sides, then divide by 2",
      "severity": "medium",
      "topics": ["algebra"],
      "concepts": ["linear equations", "inverse operations"]
    }
  ]
}
```

## Example Request

```http
POST /api/assignments/assignment-123/problems/2/errors
Content-Type: application/json

{
  "source": "error_analysis",
  "observedStep": "2x + 3 = 9, then x = 9 - 3 + 2",
  "stage": "equation solving",
  "correctness": "incorrect",
  "confidence": "high",
  "hintLevel": 2,
  "rawAnalysis": {
    "model": "error-analyzer-v1"
  },
  "mistakes": [
    {
      "errorType": "procedural",
      "mistakeSummary": "Applied inverse operations incorrectly",
      "whyWrong": "The term was not isolated using the same valid operation on both sides",
      "suggestedFix": "Subtract 3 from both sides, then divide by 2",
      "severity": "medium",
      "topics": ["algebra"],
      "concepts": ["linear equations", "inverse operations"]
    }
  ]
}
```

## Example Success Response

```json
{
  "attempt": {
    "id": "error-attempt-...",
    "userId": "user-1",
    "assignmentId": "assignment-123",
    "problemIndex": 2,
    "source": "error_analysis",
    "attemptNumber": 1,
    "observedStep": "2x + 3 = 9, then x = 9 - 3 + 2",
    "stage": "equation solving",
    "correctness": "incorrect",
    "confidence": "high",
    "hintLevel": 2,
    "rawAnalysis": {
      "model": "error-analyzer-v1"
    },
    "createdAt": 1760000000000
  },
  "mistakes": [
    {
      "id": "error-item-...",
      "attemptId": "error-attempt-...",
      "userId": "user-1",
      "assignmentId": "assignment-123",
      "problemIndex": 2,
      "ordinal": 1,
      "errorType": "procedural",
      "mistakeSummary": "Applied inverse operations incorrectly",
      "whyWrong": "The term was not isolated using the same valid operation on both sides",
      "suggestedFix": "Subtract 3 from both sides, then divide by 2",
      "severity": "medium",
      "topics": ["algebra"],
      "concepts": ["linear equations", "inverse operations"],
      "createdAt": 1760000000000
    }
  ]
}
```

## Read Endpoints

Useful for checking what was stored:

- `GET /api/assignments/:id/problems/:problemIndex/errors`
- `GET /api/assignments/:id/errors/summary?groupBy=topic`
- `GET /api/assignments/:id/errors/summary?groupBy=concept`
- `GET /api/assignments/:id/errors/summary?groupBy=errorType`
- `GET /api/errors/summary?groupBy=topic`

## Failure Handling

- `400`: payload shape or enum values are invalid
- `404`: assignment or problem does not exist for the current user
- `201`: error attempt was stored successfully

If the POST fails, log the error and continue the main tutoring flow.
