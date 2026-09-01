import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { SimulatedPayment } from "./components/SimulatedPayment";
import "./styles.css";

const path = window.location.pathname;
const RootComponent = () => {
  if (path.startsWith("/simulate-payment/")) {
    const caseId = path.split("/")[2];
    return <SimulatedPayment caseId={caseId} />;
  }
  return <App />;
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>
);
