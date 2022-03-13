# ProPresenter Network Link Tools

Currently, only one tool is available... the simulator

## ProPresenter Network Link Simulator

### To Run (requires NodeJS):

```bash
node simulator.js
```

### To Configure:

Edit the global variables at the top of the `simulator.js` file:

```JavaScript
// ProPresenter Machine to link to
const linkHost = '192.168.10.50'
const linkHostPort = 60157

// if `connectOnStart` is false, then this server
// will simply act like a ProPresenter instance
// with Link enabled waiting for a group/add_member
// request from others.
const connectOnStart = false;
```
