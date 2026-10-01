# Driver consent to texts and calls (DRAFT for attorney review)

**Shown to the owner when adding a driver** (they must check it; built with this draft wording in `src/lib/consent-words.ts`):

> ☐ This driver has agreed, in writing, to get texts and calls from [Carrier]'s dispatch line, run by Backroute, about
> their loads and work, including automated texts and calls from an AI dispatcher. I'll keep a copy of that agreement.

**The first text each driver gets** (only a driver with no consent on record; translated into the driver's language):

> [Carrier] dispatch: this is your dispatch line, run by Backroute (an AI dispatcher, with people for emergencies).
> You'll get texts and calls about your loads. Msg frequency varies. Msg & data rates may apply. Reply YES to confirm,
> HELP for help, STOP to stop texts.

**What a driver agrees to in the driver app** (shown until they answer, in the app's language; the words shown are
kept with the record):

> I agree that [Carrier] and its dispatch provider, Backroute, may text and call me, including automated texts and
> calls from an AI dispatcher, about my loads, schedule, pay and safety. Message frequency varies; message and data
> rates may apply. I can reply STOP at any time to stop texts, and HELP for help.

**Consent form for the carrier to have drivers sign** (paper or electronic):

> I agree that [Carrier] and its dispatch provider, Backroute, may send me text messages and make calls, including
> automated ones and calls from an AI assistant, to [phone number] about my loads, schedule, pay and safety. Consent
> isn't a condition of employment [confirm with counsel]. I can reply STOP at any time to stop texts, and HELP for help.
> Message frequency varies; message and data rates may apply.
> Name ______ Signature ______ Date ______

**How the app handles it today:** texts go only to drivers the carrier added. Every consent event is kept in
`driver_consents`: the owner's checkbox (who checked it and when), the driver's "I agree" or "Not now" in the app (with
the words shown, the language, the time, the device's address), YES to the first text, and each STOP and START. The
records can't be edited or deleted while the carrier is on Backroute; the owner sees each driver's latest answer in
Settings. The same records cover WhatsApp, which also requires the driver's opt-in. Voice messages a driver sends are
kept with their transcript; the AI's spoken answers are deleted after two days. The first text goes once per number,
and never to the owner (who agreed to Backroute's terms at sign-up; an owner-operator is both). Texts that can wait (a
suggestion to move a truck, the weekly check-in) wait for the driver's daytime (9 PM to 7 AM is quiet by default,
`QUIET_HOURS`), or while their ELD shows them in the sleeper; texts a load needs now still go. Setting
`CONSENT_REQUIRED=1` holds every text to a driver with no yes on record (they get only the first text) until they answer
YES, agree in the app, or the owner records that they agreed; the held texts then go out, and the owner is told once
that a driver's texts are waiting. A driver can turn texts off in the app and get notifications instead. [Per counsel:
whether to turn on `CONSENT_REQUIRED`, the quiet hours, and how long to keep the records.]
