# Customer Q&A — Session 2

**9 Sep 2026, 7.30pm.** Transcribed from `customer-qa-session2-answers.png` (that image is the original;
this file exists so the answers are searchable and diffable). If the two disagree, the image is authoritative.

| Question | Customer answer |
| --- | --- |
| For multi-session events spanning several days, can different individual sessions within the exact same event use different venues and layouts? | No need to handle multi-session events for now (see Week 4 instructions) |
| Is cancellation automatically approved, or does the assigned event coordinator have to approve it? | Automatic |
| Do Event Organisers create user accounts like Attendees do? | No need to handle account creation for release 1 |
| Does the final system need to be deployed, or will local + architecture diagram be fine? | No need to deploy |
| Do organisers need to set the registration time period during initial event submission, or only after event planning is complete? | Both are possible |
| Does ConnectSphere support multi-session multi-day events, or must they be submitted as separate requests? | No need to handle multi-session events for now (see Week 4 instructions) |
| For venues and equipment, does ConnectSphere have existing data about them, or do we mock data? | You can come up with your own list |
| What are the different room layouts? | You can suggest your own list |
| Do internal staff (Event Coordinator, Venue Staff, Technical Support) need to create accounts? If not, who creates them and where? | No need to handle account creation for release 1 |
| Previously it was said to assume equipment is always available — has that changed? | Yes, equipment counts using the new system is required, as the company is looking to support more events. In the Week 4 doc there are a few functions that involve equipment. |
| Do we have to give a name to our product, or is it called ConnectSphere? | Company name is ConnectSphere; product name you can decide |
| How many events can an event coordinator handle concurrently? | No limit |
| For internal roles, do we create their accounts instead of asking them to sign up? | Yes — create accounts and store them somewhere, so that you don't need to implement create-account functionality |
| Do we need a sign-up function for attendees, or is it the same as internal roles? | Let's just assume attendees all have accounts already, like internal roles |
| The brief says users need to securely access the system. Other than ensuring the correct role has access to the correct screens/data and password hashing, do we need to do anything about security of the app? | *(left blank — not answered)* |

## What this changed

- **Reverses** Session 1 on equipment availability: real equipment counts are now in scope.
- **Removes** all account-creation work from release 1, for every role including attendees.
- **Rules out** multi-session / multi-day events (asked twice, answered the same way both times).
- **Removes** the coordinator approval step from cancellation.
- **Removes** the deployment requirement.

The last question was left unanswered. Carry it to Session 3 rather than assuming the answer is "nothing more".
