import { render } from "preact";
import { App } from "./studio-app";
import "./app.css";

const root = document.getElementById("root");
if (root) {
  render(<App />, root);
}
