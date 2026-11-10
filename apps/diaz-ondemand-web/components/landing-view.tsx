import { AppShell } from './app-shell';
import { PageHeader } from './page-header';
import { ButtonLink } from './ui/button';
import { Card, CardActions } from './ui/card';

export function LandingView() {
  return (
    <AppShell>
      <PageHeader title="Train on your schedule." />
      <div className="grid items-start gap-600 lg:grid-cols-sidebar">
        <Card>
          <CardActions>
            <ButtonLink href="/library" size="lg" variant="primary">
              Browse free content
            </ButtonLink>
            <ButtonLink href="/sign-in" size="lg" variant="secondary">
              Sign in
            </ButtonLink>
          </CardActions>
        </Card>

        <Card className="flex flex-col gap-600">
          <h2 className="type-display-500">Unlock the full library</h2>
          <CardActions>
            <ButtonLink href="/subscribe" variant="secondary">
              View premium
            </ButtonLink>
          </CardActions>
        </Card>
      </div>
    </AppShell>
  );
}
