/**
 * App root: Locale -> Theme -> LocaleScope -> Router provider composition,
 * mirroring the Web App (LocaleScope remounts the tree keyed by locale so
 * every `S.x` read reflects the active language).
 */
import { LocaleProvider, LocaleScope } from "./state/locale";
import { ThemeProvider } from "./state/theme";
import { AppRouter } from "./router";

export function App() {
  return (
    <LocaleProvider>
      <ThemeProvider>
        <LocaleScope>
          <AppRouter />
        </LocaleScope>
      </ThemeProvider>
    </LocaleProvider>
  );
}
