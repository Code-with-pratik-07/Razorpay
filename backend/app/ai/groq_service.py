"""Advisory Groq integration. All external failure modes fall back safely."""

import json
from typing import Any

from app.ai.prompts import SYSTEM_PROMPT
from app.core.config import get_settings
from app.schemas.recovery import AIDecision


class GroqUnavailableError(RuntimeError):
    pass


def groq_structured_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Adapt Pydantic JSON Schema to Groq strict structured-output requirements."""
    normalized = json.loads(json.dumps(schema))

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            # Groq requires this on every object node, including nested definitions.
            if node.get("type") == "object" or "properties" in node:
                node["additionalProperties"] = False
                node["required"] = list(node.get("properties", {}).keys())
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(normalized)
    return normalized


def fallback_decision(context: dict[str, Any], permitted_actions: set[str], reason: str = "Deterministic fallback") -> AIDecision:
    probability = float(context.get("recovery_probability") or 0)
    action = "payment_link" if "payment_link" in permitted_actions and probability >= 0.4 else "message"
    if not permitted_actions:
        action = "escalate"
    elif action not in permitted_actions:
        action = next(iter(sorted(permitted_actions)))
    return AIDecision(
        recommended_action=action, confidence=0.5,
        reasoning=f"{reason}. The deterministic policy and recovery potential determine the permitted workflow.",
        customer_message="We noticed your payment did not complete. Please use the secure payment option to try again.",
        source="fallback",
    )


class GroqRecoveryAdvisor:
    def __init__(self, client: Any | None = None) -> None:
        settings = get_settings()
        self.model = settings.groq_model or "openai/gpt-oss-20b"
        if client is not None:
            self.client = client
            return
        if not settings.groq_api_key:
            raise GroqUnavailableError("Groq is not configured.")
        try:
            from groq import Groq
            self.client = Groq(api_key=settings.groq_api_key, timeout=12.0, max_retries=1)
        except Exception as exc:
            raise GroqUnavailableError("Groq client is unavailable.") from exc

    def advise(self, context: dict[str, Any], permitted_actions: set[str]) -> AIDecision:
        if not permitted_actions:
            return fallback_decision(context, set(), "Policy blocks automation")
        schema = groq_structured_schema(AIDecision.model_json_schema())
        prompt = json.dumps({"case": context, "permitted_actions": sorted(permitted_actions)}, default=str)
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
                temperature=0.1,
                response_format={"type": "json_schema", "json_schema": {"name": "recovery_decision", "strict": True, "schema": schema}},
            )
            content = response.choices[0].message.content or "{}"
            decision = AIDecision.model_validate_json(content)
        except Exception as exc:
            # No provider exception details are surfaced to the API or audit log.
            raise GroqUnavailableError("Groq response was unavailable or invalid.") from exc
        if decision.recommended_action not in permitted_actions:
            raise GroqUnavailableError("Groq recommended an action outside deterministic policy.")
        return decision.model_copy(update={"source": "groq"})
