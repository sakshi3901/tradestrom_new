import LegalPageLayout from "@/components/LegalPageLayout";

const topRiskPoints = [
  'Investment Risks: "Investment in securities market are subject to market risks. Read all the related documents carefully before investing."',
  "Market Volatility: Market conditions can change rapidly, and these fluctuations can lead to partial or complete loss of your investment, especially in intraday trading. Always proceed with caution and evaluate your financial situation before engaging in any trading activity.",
  '"The financial instruments or trading strategies displayed on this site are intended for educational and illustrative purposes only. They do not constitute specific investment advice or recommendations."',
  '"Past performance is not a reliable indicator of future performance. Investment results can vary significantly, and you should consider the risks involved before making any investment decisions."',
  "Any information, resources, or advice shared on this website or through social media channels is intended solely for educational purposes. It should not be construed as professional financial advice. Always seek the guidance of a qualified financial advisor before making investment decisions."
];

const disclaimerSections = [
  {
    heading: "Important Information",
    body: "Tradestrom provides information related to intraday trading strategies, analysis, and market movements. All content on this website is for informational purposes only and should not be considered as financial advice. Trading involves risk, and past performance is not indicative of future results. Always conduct your own research or consult a qualified financial advisor before making any investment decisions."
  },
  {
    heading: "Risk Disclosure",
    body: "Trading in the financial markets involves substantial risk, including the potential loss of capital. Intraday trading, in particular, is highly speculative and can result in significant gains or losses. By using Tradestrom, you acknowledge and accept the inherent risks of trading and investing."
  },
  {
    heading: "No Financial Advice",
    body: "Tradestrom does not provide personalized financial advice or investment recommendations. Any suggestions or opinions expressed on this website are solely for educational purposes. We recommend consulting with a licensed financial advisor for specific advice suited to your financial situation."
  },
  {
    heading: "Limitation of Liability",
    body: "Tradestrom and its affiliates shall not be held liable for any losses or damages arising directly or indirectly from your use of this website or any trades made based on the information provided. The use of the website and trading decisions made based on the information are solely at your own risk."
  },
  {
    heading: "Third-Party Links",
    body: "Tradestrom may include links to external websites for your convenience and informational purposes. We do not control or endorse the content, products, or services offered on these third-party sites. Accessing these websites is done at your own discretion and risk. Tradestrom is not responsible for any issues, inaccuracies, or damages arising from your use of these external links."
  },
  {
    heading: "Changes to Terms and Disclaimer",
    body: "We reserve the right to modify or update this disclaimer at any time without prior notice. Continued use of this website indicates your acceptance of any such changes."
  }
];

export default function DisclaimerPage() {
  return (
    <LegalPageLayout title="Disclaimer">
      <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed text-[#737d8b] sm:text-base">
        {topRiskPoints.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>

      <p className="mt-5 text-sm font-semibold text-[#9fadc1] sm:text-base">
        By accessing or using Tradestrom, you agree to the following:
      </p>

      <ol className="mt-4 list-decimal space-y-4 pl-6 text-sm leading-relaxed text-[#737d8b] sm:text-base">
        {disclaimerSections.map((section) => (
          <li key={section.heading}>
            <span className="font-semibold text-[#9fadc1]">{section.heading}</span>
            <br />
            {section.body}
          </li>
        ))}
      </ol>

      <p className="mt-6 text-sm leading-relaxed text-[#737d8b] sm:text-base">
        <span className="font-semibold text-[#9fadc1]">Contact Us</span>
        <br />
        If you have any questions or concerns regarding information and services, please contact us
        at:
        <br />
        <span className="font-semibold text-[#9fadc1]">supt.tcienterprise@gmail.com</span>
      </p>
    </LegalPageLayout>
  );
}
