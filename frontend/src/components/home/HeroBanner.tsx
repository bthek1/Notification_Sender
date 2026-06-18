import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function HeroBanner() {
  return (
    <section className="flex flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        Welcome to <span className="text-primary">My App</span>
      </h1>
      <p className="max-w-md text-lg text-muted-foreground">
        A modern full-stack web application built with Django and React.
      </p>
      <div className="flex flex-wrap justify-center gap-4">
        <Button asChild size="lg">
          <Link to="/login">Sign in</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link to="/signup">Create account</Link>
        </Button>
      </div>
    </section>
  );
}
