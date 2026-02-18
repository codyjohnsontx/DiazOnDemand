import { Card } from './Card';

type TestimonialProps = {
  quote: string;
  name: string;
  detail: string;
};

export function Testimonial({ quote, name, detail }: TestimonialProps) {
  return (
    <Card className="h-full bg-white">
      <p className="text-lg leading-relaxed text-ink">“{quote}”</p>
      <p className="mt-5 text-sm font-semibold text-ink">{name}</p>
      <p className="text-sm text-black/60">{detail}</p>
    </Card>
  );
}
