import LegalPageLayout from "@/components/LegalPageLayout";

const whyTradestromPoints = [
  "Instantly Spot the Biggest Intraday Moves - Stay ahead of the market with real-time alerts on the best trading opportunities.",
  "One-Click Simplicity - No complicated setups; just plug in and start trading smarter.",
  "Proven Results - Our tool has helped traders achieve exponential profits by capturing market trends at the right time.",
  "Designed for All Traders - Whether you are a day trader, swing trader, or scalper, TradeStrom is built to enhance your strategies."
];

function Heading({ children }) {
  return (
    <h2 className="mt-8 text-lg font-semibold tracking-[-0.01em] text-[#9fadc1] sm:text-xl">{children}</h2>
  );
}

function Text({ children }) {
  return <p className="mt-3 text-sm leading-relaxed text-[#737d8b] sm:text-base">{children}</p>;
}

export default function AboutUsPage() {
  return (
    <LegalPageLayout title="About Us">
      <Heading>Welcome to TradeStrom - Your Ultimate Trading Companion</Heading>
      <Text>
        At <strong className="font-semibold text-[#9fadc1]">TradeStrom</strong>, we believe in
        empowering traders with cutting-edge technology that simplifies and enhances their trading
        experience. Our powerful tool is designed to identify high-potential intraday moves,
        helping traders maximize their profits with ease.
      </Text>

      <Heading>Our Journey</Heading>
      <Text>
        TradeStrom was born out of a passion for trading and a vision to create a tool that
        delivers <strong className="font-semibold text-[#9fadc1]">real-time, high-impact market insights</strong>.
        With a focus on accuracy, speed, and efficiency, TradeStrom has helped traders{" "}
        <strong className="font-semibold text-[#9fadc1]">
          transform small investments into significant gains
        </strong>{" "}
        in a short span.
      </Text>
      <Text>
        One of our most remarkable success stories is turning an initial investment into{" "}
        <strong className="font-semibold text-[#9fadc1]">10X profits in just a few weeks</strong>,
        proving the true power of this tool. Whether you are an experienced trader or just
        starting, TradeStrom provides the edge you need to stay ahead in the market.
      </Text>

      <Heading>Why TradeStrom?</Heading>
      <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-relaxed text-[#737d8b] sm:text-base">
        {whyTradestromPoints.map((point) => (
          <li key={point}>
            <span className="font-semibold text-[#9fadc1]">{point.split(" - ")[0]} - </span>
            {point.split(" - ").slice(1).join(" - ")}
          </li>
        ))}
      </ul>

      <Heading>Our Mission</Heading>
      <Text>
        We are committed to{" "}
        <strong className="font-semibold text-[#9fadc1]">revolutionizing trading</strong> by
        making it faster, smarter, and more accessible to everyone. TradeStrom is more than just a
        tool. It is your trading partner, helping you{" "}
        <strong className="font-semibold text-[#9fadc1]">
          seize opportunities, minimize risks, and maximize returns
        </strong>{" "}
        with confidence.
      </Text>

      <Heading>Join the TradeStrom Revolution</Heading>
      <Text>
        Take control of your trading success today! With{" "}
        <strong className="font-semibold text-[#9fadc1]">TradeStrom</strong>, you do not just
        trade. You trade smarter, faster, and more profitably. Ready to experience the power of
        TradeStrom? Let us ride the market waves together!
      </Text>
      <h3 className="mt-6 text-lg font-semibold text-[#9fadc1] sm:text-xl">
        🚀 Start Your Journey with TradeStrom Now!
      </h3>
    </LegalPageLayout>
  );
}
