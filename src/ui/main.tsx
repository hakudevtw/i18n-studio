import { render } from "preact";
import { App } from "./studio-app";
import { applyTheme, readTheme } from "./theme";
import "./app.css";

applyTheme(readTheme());

const root = document.getElementById("root");
if (root) {
  render(<App />, root);
}
