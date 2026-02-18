export default function SubscribeSuccessPage() {
  return (
    <div className="rounded border bg-white p-6">
      <h1 className="text-xl font-semibold">Subscription successful</h1>
      <p className="mt-2 text-sm text-gray-700">Your entitlement will update after Stripe webhook processing.</p>
    </div>
  );
}
