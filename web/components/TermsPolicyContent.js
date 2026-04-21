const legalDefs = [
  "Owner, We, Us, Our: The term Owner refers to the entity responsible for the creation, management, and operation of the Website. We, Us, Our, and any other first-person pronouns refer to the Owner and include its employees, contractors, affiliates, and agents involved in providing the Services on the Website.",
  "You, the User, the Subscriber, the Client: You, Your, User, Client, and Subscriber refer to the individual or legal entity accessing or utilizing the Website and its Services. These terms are used interchangeably throughout these Terms of Service to describe the person(s) entering into this agreement with the Owner.",
  "Parties: Parties collectively refers to the Owner and You, the User, as the two parties involved in the agreement formed under these Terms of Service."
];

const reverseEngineeringRules = [
  "Prohibition on Reverse Engineering: You may not reverse engineer, decompile, or attempt to extract the source code or underlying structure of the Website or any of its software components.",
  "Unauthorized Access: You shall not attempt to gain unauthorized access to the Website, servers, systems, or any user data, nor interfere with the Website's security or functionality.",
  "Security Compliance: You agree not to introduce any harmful software (e.g., viruses, malware) that could compromise the Website's security or disrupt its operation."
];

const prohibitedActivities = [
  "Systematically retrieve data or other content from the Services to create or compile, directly or indirectly, a collection, compilation, database, or directory without written permission from us.",
  "Circumvent, disable, or otherwise interfere with security-related features of the Services, including features that prevent or restrict the use or copying of any Content or enforce limitations on the use of the Services and/or the Content contained therein.",
  "Impersonating another individual or entity, or providing false or misleading information during registration or transactions.",
  "Attempting to gain unauthorized access to the Website, its servers, or other users accounts and personal information.",
  "Introducing viruses, malware, or any harmful code to disrupt the Website or other users' experiences.",
  "Engaging in any activity that violates laws, regulations, or legal obligations."
];

const privacyInformation = [
  "Information Collection: We may collect personal details such as your name, email address, payment information, and usage data when you interact with the Website or subscribe to our services.",
  "Usage of Information: Your personal data will be used to process transactions, communicate with you, improve our services, and ensure the functionality and security of the Website."
];

const indemnificationPoints = [
  "use of the Services",
  "breach of these Legal Terms",
  "any breach of your representations and warranties set forth in these Legal Terms",
  "your violation of the rights of a third party, including but not limited to intellectual property rights",
  "any overt harmful act toward any other user of the Services with whom you connected via the Services. Notwithstanding the foregoing, we reserve the right, at your expense, to assume the exclusive defense and control of any matter for which you are required to indemnify us, and you agree to cooperate, at your expense, with our defense of such claims. We will use reasonable efforts to notify you of any such claim, action, or proceeding which is subject to this indemnification upon becoming aware of it."
];

const disclaimerPoints = [
  'Investment Risks: "Investment in securities market are subject to market risks. Read all the related documents carefully before investing."',
  "Market Volatility: Market conditions can change rapidly, and these fluctuations can lead to partial or complete loss of your investment, especially in intraday trading. Always proceed with caution and evaluate your financial situation before engaging in any trading activity.",
  '"The financial instruments or trading strategies displayed on this site are intended for educational and illustrative purposes only. They do not constitute specific investment advice or recommendations."',
  '"Past performance is not a reliable indicator of future performance. Investment results can vary significantly, and you should consider the risks involved before making any investment decisions."',
  "Any information, resources, or advice shared on this website or through social media channels is intended solely for educational purposes. It should not be construed as professional financial advice. Always seek the guidance of a qualified financial advisor before making investment decisions."
];

function SectionHeading({ children }) {
  return (
    <h2 className="mt-8 text-lg font-semibold tracking-[-0.01em] text-[#9fadc1] sm:text-xl">{children}</h2>
  );
}

function Paragraph({ children }) {
  return <p className="mt-3 text-sm leading-relaxed text-[#737d8b] sm:text-base">{children}</p>;
}

export default function TermsPolicyContent({ title }) {
  return (
    <div>
      <Paragraph>Effective Date: Mar 25, 2025</Paragraph>

      <SectionHeading>THE AGREEMENT</SectionHeading>
      <Paragraph>We are TradeStrom ("Company," "we," "us," "our").</Paragraph>
      <Paragraph>
        We operate the website http://www.tradestrom.com (the "Site"), as well as any other
        related products and services that refer or link to these terms (the "Terms")
        (collectively, the "Services").
      </Paragraph>
      <Paragraph>
        These Terms constitute a legally binding agreement made between you, whether personally or
        on behalf of an entity ("you"), and TradeStrom, concerning your access to and use of the
        Services. You agree that by accessing the Services, you have read, understood, and agreed
        to be bound by all of these Terms.
      </Paragraph>

      <SectionHeading>1. DEFINITIONS</SectionHeading>
      <Paragraph>The parties referred to in these Terms of Service shall be defined as follows:</Paragraph>
      <ol className="mt-3 list-[lower-alpha] space-y-2 pl-6 text-sm leading-relaxed text-[#737d8b] sm:text-base">
        {legalDefs.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>

      <SectionHeading>2. ACCEPTANCE OF TERMS</SectionHeading>
      <Paragraph>
        By accessing, browsing, or using the Website or any of its Services, you (the "User" or
        "Client") acknowledge and agree to comply with these Terms of Service. Your use of the
        Website signifies your acceptance of these terms, as well as any other applicable
        policies, agreements, or notices provided by the Owner. If you do not agree with any part
        of these Terms of Service, you must immediately cease using the Website and its Services.
      </Paragraph>

      <SectionHeading>3. Description of Services</SectionHeading>
      <Paragraph>
        Tradestrom provides users with real-time intraday trading signals, market analysis, and
        educational resources to assist with their trading decisions. These services are for
        informational purposes only and should not be considered as financial advice.
      </Paragraph>

      <SectionHeading>4. REVERSE ENGINEERING & SECURITY</SectionHeading>
      <Paragraph>By using Tradestrom, you agree to the following:</Paragraph>
      <ol className="mt-3 list-[lower-alpha] space-y-2 pl-6 text-sm leading-relaxed text-[#737d8b] sm:text-base">
        {reverseEngineeringRules.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      <Paragraph>Any such behavior may result in the suspension or termination of your account.</Paragraph>

      <SectionHeading>5. LICENSE TO USE WEBSITE</SectionHeading>
      <Paragraph>
        The Owner grants you a limited, non-exclusive, non-transferable license to access and use
        the Website and its Services for personal, non-commercial purposes, in accordance with
        these Terms of Service.
      </Paragraph>
      <Paragraph>
        You may view, browse, and interact with the Website's content and features for your own
        personal use. You may not use the Website for any illegal, unauthorized, or commercial
        purposes.
      </Paragraph>
      <Paragraph>
        You are prohibited from copying, modifying, distributing, selling, or otherwise exploiting
        any part of the Website, its content, or services, except as expressly permitted under
        these Terms.
      </Paragraph>

      <SectionHeading>6. Risk Disclosure</SectionHeading>
      <Paragraph>
        Trading involves substantial risk and is not suitable for every investor. Intraday trading
        can result in significant gains but also substantial losses. You should carefully consider
        your financial situation and seek professional advice before engaging in any trading
        activities.
      </Paragraph>
      <Paragraph>
        Tradestrom does not guarantee any specific returns, profits, or success. Past performance
        is not indicative of future results. Your trading decisions are your own responsibility.
      </Paragraph>
      <Paragraph>
        Financial markets are highly volatile and can change rapidly. Tradestrom is not responsible
        for any losses due to market conditions or unforeseen events.
      </Paragraph>

      <SectionHeading>7. No Financial or Investment Advice</SectionHeading>
      <Paragraph>
        The content provided by Tradestrom, including trading signals, market analysis, and
        educational material, is for informational purposes only. Tradestrom does not offer
        personalized financial or investment advice. You should always consult with a licensed
        financial advisor before making any investment or trading decisions.
      </Paragraph>

      <SectionHeading>8. Intellectual Property Rights</SectionHeading>
      <Paragraph>
        All content, functionality, logos, trademarks, service marks, and other intellectual
        property available on Tradestrom are owned by Tradestrom or its licensors and are protected
        by intellectual property laws.
      </Paragraph>
      <Paragraph>
        You are granted a limited, non-exclusive, non-transferable license to use the website and
        services for personal, non-commercial use. You may not reproduce, distribute, modify,
        display, or create derivative works from the content of Tradestrom without prior written
        consent.
      </Paragraph>

      <SectionHeading>9. PURCHASES AND PAYMENT</SectionHeading>
      <Paragraph>
        All prices for services or subscription plans are clearly stated on the Website. The Owner
        reserves the right to change pricing at any time, but such changes will not affect existing
        subscriptions until the next renewal.
      </Paragraph>
      <Paragraph>
        All subscriptions are non-refundable. Once you make a purchase, you will not be able to
        cancel or receive a refund for any charges, regardless of whether or not you use the
        service during the subscription period.
      </Paragraph>

      <SectionHeading>10. PRIVACY AND DATA PROTECTION</SectionHeading>
      <Paragraph>
        We may collect personal information, such as your name, email address, and payment details,
        to provide services and improve your experience on the Website. Your data will be used
        solely for the purposes of processing transactions, providing services, and communicating
        with you about your account or our offerings. We do not sell or rent your personal data to
        third parties.
      </Paragraph>

      <SectionHeading>11. PROHIBITED ACTIVITIES</SectionHeading>
      <Paragraph>As a user of the Services, you agree not to:</Paragraph>
      <ol className="mt-3 list-[lower-alpha] space-y-2 pl-6 text-sm leading-relaxed text-[#737d8b] sm:text-base">
        {prohibitedActivities.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>

      <SectionHeading>12. PRIVACY INFORMATION</SectionHeading>
      <Paragraph>
        Through Your Use of the Website and Services, You may provide Us with certain information.
        By using the Website or the Services, You authorize the Owner to use Your information in
        India and any other country where We may operate.
      </Paragraph>
      <ol className="mt-3 list-[lower-alpha] space-y-2 pl-6 text-sm leading-relaxed text-[#737d8b] sm:text-base">
        {privacyInformation.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>

      <SectionHeading>13. MODIFICATIONS AND INTERRUPTIONS</SectionHeading>
      <Paragraph>
        We reserve the right to change, modify, or remove the contents of the Services at any time
        or for any reason at our sole discretion without notice. However, we have no obligation to
        update any information on our Services. We will not be liable to you or any third party for
        any modification, price change, suspension, or discontinuance of the Services.
      </Paragraph>
      <Paragraph>
        We cannot guarantee the Services will be available at all times. We may experience
        hardware, software, or other problems or need to perform maintenance related to the
        Services, resulting in interruptions, delays, or errors. We reserve the right to change,
        revise, update, suspend, discontinue, or otherwise modify the Services at any time or for
        any reason without notice to you.
      </Paragraph>

      <SectionHeading>14. LIMITATIONS OF LIABILITY</SectionHeading>
      <Paragraph>
        We shall not be held liable for any losses or damages arising directly or indirectly from
        your use of this website or any trades made based on the information provided. The use of
        the website and trading decisions made based on the information are solely at your own risk.
      </Paragraph>

      <SectionHeading>15. INDEMNIFICATION</SectionHeading>
      <Paragraph>
        You agree to defend, indemnify, and hold us harmless, including our subsidiaries,
        affiliates, and all of our respective officers, agents, partners, and employees, from and
        against any loss, damage, liability, claim, or demand, including reasonable attorneys' fees
        and expenses, made by any third party due to or arising out of:
      </Paragraph>
      <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm leading-relaxed text-[#737d8b] sm:text-base">
        {indemnificationPoints.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>

      <SectionHeading>16. USER DATA</SectionHeading>
      <Paragraph>
        We will maintain certain data that you transmit to the Services for the purpose of managing
        the performance of the Services, as well as data relating to your use of the Services.
        Although we perform regular routine backups of data, you are solely responsible for all
        data that you transmit or that relates to any activity you have undertaken using the
        Services.
      </Paragraph>

      <SectionHeading>17. ELECTRONIC COMMUNICATIONS, TRANSACTIONS, AND SIGNATURES</SectionHeading>
      <Paragraph>
        Visiting the Services, sending us emails, and completing online forms constitute electronic
        communications. You consent to receive electronic communications, and you agree that all
        agreements, notices, disclosures, and other communications we provide to you electronically,
        via email and on the Services, satisfy any legal requirement that such communication be in
        writing.
      </Paragraph>

      <SectionHeading>18. MISCELLANEOUS</SectionHeading>
      <Paragraph>
        These Terms and any policies or operating rules posted by us on the Services or in respect
        to the Services constitute the entire agreement and understanding between you and us. Our
        failure to exercise or enforce any right or provision of these Terms shall not operate as a
        waiver of such right or provision.
      </Paragraph>

      <SectionHeading>Disclaimers:</SectionHeading>
      <ol className="mt-3 list-[lower-roman] space-y-2 pl-6 text-sm leading-relaxed text-[#737d8b] sm:text-base">
        {disclaimerPoints.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>

      <SectionHeading>Changes to Disclaimer</SectionHeading>
      <Paragraph>
        We reserve the right to modify or update this disclaimer at any time without notice. Your
        continued use of this website/platform constitutes your acceptance of any changes.
      </Paragraph>

      <SectionHeading>Contact Us</SectionHeading>
      <Paragraph>
        If you have any questions or concerns regarding information and services, please contact us
        at: <span className="font-semibold text-[#9fadc1]">supt.tcienterprise@gmail.com</span>
      </Paragraph>
    </div>
  );
}
