from app.services.providers.base import BaseCommunicationProvider, ProviderResult
from app.services.providers.email_provider import EmailCommunicationProvider
from app.services.providers.sms_provider import SimulatedSMSProvider
from app.services.providers.whatsapp_provider import SimulatedWhatsAppProvider

_PROVIDERS: dict[str, BaseCommunicationProvider] = {
    "email": EmailCommunicationProvider(),
    "sms": SimulatedSMSProvider(),
    "whatsapp": SimulatedWhatsAppProvider(),
}


def get_communication_provider(channel: str) -> BaseCommunicationProvider:
    """Retrieve communication provider for the specified channel.
    
    Defaults to EmailCommunicationProvider if channel is unknown.
    """
    return _PROVIDERS.get(channel.lower(), _PROVIDERS["email"])


__all__ = [
    "BaseCommunicationProvider",
    "EmailCommunicationProvider",
    "ProviderResult",
    "SimulatedSMSProvider",
    "SimulatedWhatsAppProvider",
    "get_communication_provider",
]
