const http = require( 'http' )
const url = require( 'url' );
const { exit } = require( 'process' );


// CONFIGURATION BEGINS HERE
// heartbeat settings
const heartbeatInterval = 1000;
const logHeartbeats = false;
let heartbeatTimer = 0;

// ProPresenter Machine to link to
const linkHost = '192.168.10.50'
const linkHostPort = 60157

// if `connectOnStart` is false, then this server
// will simply act like a ProPresenter instance
// with Link enabled waiting for a group/add_member
// request from others.
const connectOnStart = true;


// LOCAL DATA OBJECTS ================================

// `me` represents ourselves to the network
// note, the IP address for `me` must be different from
// the linkHost, using '0.0.0.0' or a loopback address
// allows a masquerade server on the same computer as the 
// running ProPresenter instance.
const me = {
  ip: '127.0.0.1',
  port: 60000,
  connected: false,
  name: 'masquerader',
  platform: "mac",
  os_version: "10.15.6",
  host_description: "ProPresenter 7.8",
  api_version: ""
}

// `group` stores all the group data for the network
// each node on the network needs to keep a representation
// of the entire network. The format here is for our use only.
const group = {
  secret: "",
  name: "",
  members: [],
  members_by_ip: {},
}

// NON-CONFIGURATION CONSTANTS ==========================
const term = {
  home: '\r',
  esc: '\u001b',
  reset: '\u001b[0m',
  black: '\u001b[30m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  white: '\u001b[37m',
  color: ( n ) => n == null ? `\u001b[0m` : `\u001b[3${n}m`,
  up: ( n ) => `\u001b[${n}A`,
  down: ( n ) => `\u001b[${n}B`,
  right: ( n ) => `\u001b[${n}C`,
  left: ( n ) => `\u001b[${n}D`,
}

// FUNCTIONS ============================================

// the Network Link API returns a timestamp with heartbeat
// and group/status requests, but the actual data seems to
// be irrelevant for now. Each node in a group just reuses
// the same values, so who knows when or if this function
// will ever become helpful.
const timestamp = function () {
  let now = Date.now();
  let seconds = Math.floor( now / 1000 );
  let millis = now % 1000;
  let nanos = millis * 1000 * 1000;
  return { seconds, nanos }
}

// The `status` function will format our current group data into a format
// that is compatible with the network link API. We could store the data this
// way to begin with, but this allows future flexibility.
const status = function ( asHeartbeatResponse = false ) {
  let retval = {
    group_definition: {
      timestamp: group.timestamp ?? timestamp(),
      secret: group.secret,
      name: group.name,
      members: [],
    },
    member_name: me.name,
  }
  for ( let member of group.members ) {
    retval.group_definition.members.push( { ip: member.ip, port: member.port } )
  }
  if ( asHeartbeatResponse ) {
    retval.status = me;
  }
  return retval;
}


// We could use an HTTP library like axios, but that's overkill for our
// limited needs. Instead, we just wrap the native http request and employ
// success and error callbacks.
const doRequest = function ( { verb, host, port, path, data = {}, success = null, error = null } ) {
  verb = verb.toUpperCase();
  const dataString = JSON.stringify( data )
  const options = {
    hostname: host,
    port: port,
    path: path,
    method: verb,
  }
  if ( verb == 'POST' ) {
    options.headers = {
      'accept': '*/*',
      'content-type': 'application/json',
      'content-length': dataString.length
    }
  }

  const req = http.request( options, res => {
    // console.log( `res status: ${res.statusCode}` )
    res.body = ''
    res.on( 'data', d => {
      res.body += d;
    } )

    res.on( 'end', () => {
      res.data = JSON.parse( res.body );
      if ( success != null ) success( res );
    } )
  } )

  req.on( 'error', e => {
    // a linked host isn't online right now
    if ( e.code == 'ECONNREFUSED' ) { }

    // console.error( e );
    if ( error != null ) error( e );
  } )

  if ( verb == 'POST' ) {
    req.write( dataString );
  }
  req.end();
}


// `handleRequest` should act like a real ProPresenter instance
// but we currently only respond to these requests:
// `/heartbeat`, `/group/status`, `/group/add_member`
const handleRequest = function ( req, res ) {

  // read all the body data in streaming fashion and tack it on to the
  // original request just like `express` might
  req.body = '';
  req.on( 'data', chunk => req.body += chunk );

  // after request is fully received...
  req.on( 'end', () => {
    try {
      req.data = JSON.parse( req.body );
    } catch ( e ) {
      req.data = null
    }

    // parse the url into path and query variables
    let parsed = url.parse( req.url, true );
    req.path = parsed.pathname;
    req.query = parsed.query;

    // prepare our response
    let reply = ''
    switch ( req.path ) {
      case '/group/status':
        reply = JSON.stringify( status() )
        break;
      case '/heartbeat':
        reply = JSON.stringify( status( true ) )
        break;
      case '/group/add_member':
        // first, add this new member to our group data
        if ( req.data ) {
          let member = req.data.GroupMember;
          if ( member.ip ) {
            group.members_by_ip[ member.ip ] = member;
            group.members = Object.values( group.members_by_ip );
            s = { GroupDefinition: status().group_definition };
            reply = JSON.stringify( s );
          }
        }
      default:
    }

    // log the request details and results unless it should be hidden
    if ( req.path != '/heartbeat' || logHeartbeats ) {
      showStatus.advanceFirst = true;
      console.log( `\n${term.yellow}EVENT: ${req.url}${term.reset}` );
      // console.dir( req.headers, { depth: 4 } )
      // console.log( req.url )
      // console.log( `${req.method} ${req.url}` )
      console.dir( req.data ?? req.body )
      if ( reply != '' ) {
        console.log( `\n${term.yellow}SENDING REPLY:${term.reset}` )
        console.log( reply )
      }
    }
    if ( req.path == '/heartbeat' ) {
      showStatus();
    }
    res.setHeader( 'accept', '*/*' );
    res.setHeader( 'content-type', 'application/json' );
    res.writeHead( 200 );
    res.end( reply );
  } )
}

// `heartbeat` sends out a `/heartbeat` request to every member of the
// current group to make sure each member is still alive.
const heartbeat = function () {
  if ( logHeartbeats ) { console.log( 'SENDING HEARTBEATS' ); }
  for ( let m of group.members ) {

    // never send heartbeats to self
    if ( !m.ip || m.ip == me.ip ) continue;

    doRequest( {
      verb: 'GET',
      host: m.ip,
      port: m.port,
      path: `/heartbeat?port=${me.port}`,
      success: ( res ) => {
        if ( logHeartbeats ) {
          console.log( 'HEARTBEAT RESPONSE' );
          console.dir( res.body, { depth: 5 } )
          console.dir( res.data, { depth: 5 } )
        }
        handleResponse( res );
        group.members_by_ip[ m.ip ].connected = true;
      },
      error: ( e ) => {
        if ( e.code == 'ECONNREFUSED' ) {
          group.members_by_ip[ m.ip ].connected = false;
        }
      }
    } )
  }
}

// `handleResponse` parses the data from an HTTP response
// to update the current group data.
const handleResponse = function ( res ) {
  if ( 'GroupDefinition' in res.data ) res.data.group_definition = res.data.GroupDefinition;
  let { secret, name, members } = res.data.group_definition
  group.secret = secret
  group.name = name
  group.members = []
  for ( let m of members ) {
    if ( !group.members_by_ip[ m.ip ] ) {
      group.members_by_ip[ m.ip ] = m;
    }
  }

  // `heartbeat` responses include a `status` member
  // that gives more detail for the specific node that
  // just responded
  if ( 'status' in res.data ) {
    // `member` will be empty if this was not a heartbeat
    let member = { ...res.data.status }
    group.members_by_ip[ member.ip ] = member;
  }
  group.members = Object.values( group.members_by_ip )
}

/**
 * Handshake process...
 * GET /group/status  on remote server
 * Response looks like this:
{
  group_definition: {
    timestamp: {
      seconds: 1647033165,
        nanos: 85736000
    },
    secret: "",
      name: "LCC Primary",
        members: [
          {
            ip: "192.168.50.11",
            port: 60157
          },
          {
            ip: "192.168.50.58",
            port: 52273
          },
          {
            ip: "192.168.10.50",
            port: 60157
          }
        ]
  },
  member_name: "paul"
}
 * timestamp data seems to be irrelevant
 * each "group" seems to share the same timestamp values
 * so, after doing the status, just store what you get
 * and keep modifying that data
 * 
 * 2. REQUEST ADDITION TO GROUP
 * POST /group/add_member
 * body (application/json) looks like this:
 * { "GroupMember": { "ip": "0.0.0.0", "port": 99999 } }
 *                            my ip           my port
 * 
 * RESPONSE WILL LOOK LIKE THIS
 * '{ "GroupDefinition": { "timestamp": { "seconds": 1647039552, "nanos": 104471000 }, "secret": "", "name": "LCC Primary", "members": [ { "ip": "192.168.50.11", "port": 60157 }, { "ip": "192.168.50.58", "port": 52273 }, { "ip": "192.168.10.50", "port": 60157 } ] } }'
 * Note, it is exactly the same as a normal status response, but the key
 * is 'GroupDefinition' instead of 'group_definition' <shrug>
 * 
 */
const connect = function ( host, port, success, error ) {
  // STEP 1: request group status
  console.log( `\nATTEMPTING TO CONNECT TO ${host}:${port}` )
  doRequest( {
    verb: 'get',
    host,
    port,
    path: '/group/status',
    success: ( res ) => {
      console.log( `-- HOST IS ALIVE ${host}:${port}` )
      if ( res.data.group_definition ) {
        handleResponse( res );
      }
      // STEP 2: check to see if we are in the group yet
      if ( me.ip in group.members_by_ip ) {
        if ( success ) success();
      };

      // STEP 3: ask to join the group
      console.log( `-- ASKING TO JOIN GROUP: ${group.name}` )
      doRequest( {
        verb: 'post', host, port, data: {
          GroupMember: { ip: me.ip, port: me.port }
        }, path: '/group/add_member', success: ( res ) => {
          console.log( `-- RESPONSE RECEIVED` )
          handleResponse( res );
          if ( me.ip in group.members_by_ip ) {
            group.members_by_ip[ me.ip ] = me;
            console.log( `-- We're in!\n` )
            if ( success ) success();
          } else {
            if ( error ) error();
          }
        }
      } )
    },
    error
  } )
}

const startHeartbeat = function () {
  if ( heartbeatTimer ) clearInterval( heartbeatTimer )
  heartbeatTimer = setInterval( heartbeat, heartbeatInterval );
}

const showStatus = function () {
  let statusLines = group.members.length + 2
  if ( showStatus.advanceFirst ) {
    for ( let i = 0; i < statusLines; i++ ) { console.log( '                                                ' ) }
  }
  showStatus.advanceFirst = false;
  process.stdout.write( `${term.reset}${term.home}${term.up( statusLines )}` );
  process.stdout.write( `\n=== LINK: ${group.name} (${group.members.length} members) ===\n` )
  for ( let member of group.members ) {
    const indicator = member.ip == me.ip ? ' me ' : ' •  ';
    const color = member.connected ? term.green : term.red;
    process.stdout.write( '                                                                   \r' );
    process.stdout.write( `${color}${indicator}${term.white} ${member.name} - ${member.ip}:${member.port}\n` );
  }
  // process.stdout.write( `${term.reset}${term.home}${term.up( group.members.length + 2 )}` );
}


/** BEGIN MAIN CODE */
const server = http.createServer( handleRequest );

server.listen( me.port, me.ip, () => {
  showStatus.advanceFirst = true;

  if ( connectOnStart ) {
    // if we connect successfully, the response will populate
    // all the group data
    connect( linkHost, linkHostPort, () => {
      console.log( `CONNECTED TO GROUP: ${group.name}` )
      console.log( `-- LISTENING TO EVENTS AND SENDING HEARTBEATS --` )
      me.connected = true;
    }, () => {
      console.log( `COULD NOT CONNECT` )
      exit();
    } );
  } else {
    // since we aren't connecting, we need to pretend we are a ProPresenter
    // instance waiting for connections. Therefore, we setup our own group
    // data first
    group.name = 'Network Link Simulator Group'
    group.members_by_ip[ me.ip ] = me
    group.members.push( me );
    group.timestamp = timestamp();
    me.connected = true;

    // now, we should be able to respond to any network link requests
    console.log( `WAITING FOR NETWORK LINK REQUESTS ON ${me.ip}:${me.port}` )
  }
  startHeartbeat();

} )
