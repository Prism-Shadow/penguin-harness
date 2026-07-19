/**
 * App root component: Locale -> Theme -> Auth -> LocaleScope -> Router provider composition.
 * LocaleScope (a remount boundary) sits inside AuthProvider: switching language rebuilds the UI tree without
 * re-fetching auth, avoiding a full-screen white flash from RequireAuth briefly seeing user=undefined.
 */
import { LocaleProvider, LocaleScope } from "./state/locale";
import { ThemeProvider } from "./state/theme";
import { AuthProvider } from "./state/auth";
import { AppRouter } from "./router";
import { Toaster } from "./components/ui/toast";

export function App() {
  return (
    <LocaleProvider>
      <ThemeProvider>
        <AuthProvider>
          <LocaleScope>
            <AppRouter />
            {/* Top toast overlay: portaled to body, z-index above modals, shared site-wide. */}
            <Toaster />
          </LocaleScope>
        </AuthProvider>
      </ThemeProvider>
    </LocaleProvider>
  );
}
